from math import isnan
import asyncio
import math
from pydantic import BaseModel
from . import connection as con


# =================== DATA MODELS ===================
class JogRequest(BaseModel):
    direction: str
    step: float
    feed: float

class SetCalibration(BaseModel):
    cx: float
    cy: float
    cz: float
    feed:float

class SetStartingPoint(BaseModel):
    zx: float
    zy: float
    zz: float

class ToStartingPoint(BaseModel):
    to_x: float
    to_y: float
    to_z: float
    feed: float

class ConnectRequest(BaseModel):
    port: str = "/dev/ttyUSB0"
    baudrate: int = 115200

class SprayingRequest(BaseModel):
    panjang: float
    lebar: float
    diameter: float
    feed_rate: float


# =================== DATA MANAGEMENT ===================

currentStatus = {
    "position":    [0.00, 0.00, 50.00],  # [x, y, z]
    "pausedAtPos": [0.0, 0.0, 0.0],
    "isSpraying":  False,
    "isPaused":    False,
    "connected":   False,
    "startPoint":  False,
    "constraints": False,
    "feed":        1000,
    "progress":    0,
    "lastReport":  "-",
    "lastMessage": "GRBL ready",
    "emergency_stop": False
}

sprayState = {
    "isActive": False,
    "isPaused": False,
    "progress": 0,
    "path":     [],
    "seconds":  0,
    "animId":   None,
}

tileSize = {
    "w": 300,
    "h": 400,
}

constraints = {"x": 440, "y": 500, "z": 80}
_stop_spraying_flag = False


# =================== CONTROL ALGORITHM ===================
def _sync_connection_status():
    currentStatus["connected"] = con.is_connected()

def stop_process():
    global _stop_spraying_flag
    _stop_spraying_flag = True
    ok, msg = con.emergency_stop()
    currentStatus["isSpraying"] = False
    currentStatus["lastMessage"] = "Proses dihentikan paksa"
    return ok, msg

def pause_process():
    _sync_connection_status()
    if not currentStatus["connected"]:
        return {"success": False, "message": "Mesin sedang tidak berjalan"}
    
    ok, msg = con.pause()
    if ok:
        currentStatus["isPaused"] = True
        currentStatus["pausedAtPos"] =  currentStatus["position"].copy()
        currentStatus["lastMessage"] = "Proses dijeda pada koordinat x{:.2f} y{:.2f} z{:.2f}".format(*currentStatus["position"])
        return {"success": True, "message": msg, "status": currentStatus}

def resume_process():
    _sync_connection_status()
    if not currentStatus["connected"]:
        return {"success": False, "message": "Mesin sedang tidak berjalan"}
    
    ok, msg = con.resume()
    if ok:
        currentStatus["isPaused"] = False
        currentStatus["lastMessage"] = "Proses dilanjutkan dari koordinat x{:.2f} y{:.2f} z{:.2f}".format(*currentStatus["pausedAtPos"])
        return {"success": True, "message": msg, "status": currentStatus}


# =================== SPRAYING ALGORITHM ===================

def spraying_gcode(panjang: float, lebar: float, diameter: float, feed_rate: float):

    gcode = [
        "G90",
        f"G1 X0 Y0 F{feed_rate}",
        "M3"
    ]

    line_count = max(1, math.ceil(lebar / diameter))

    remaining_coverage = lebar - diameter
    step_over = math.floor(remaining_coverage / (line_count - 1))

    # step_over = lebar

    current_y = 0.0
    direction = 1

    total_distance = 0.0
    current_x = 0.0

    for line in range(line_count):
        
        # Gerakan vertikal dikurangi radius agar area spray tidak lebih dari tujuan
        target_x = (panjang - diameter) if direction > 0 else 0.0

        gcode.append(
            f"G1 X{target_x} Y{current_y} F{feed_rate}"
        )

        total_distance += abs(target_x - current_x)
        current_x = target_x

        next_y = current_y + step_over

        # Gerakan horizontal dikurangi radius agar area spray tidak lebih dari tujuan
        if next_y <= (lebar - math.floor(diameter / 2)):
            gcode.append(
                f"G1 X{current_x} Y{next_y} F{feed_rate}"
            )

            total_distance += abs(next_y - current_y)

        current_y = next_y
        direction *= -1

    gcode.extend([
        "M5",
        f"G1 X0 Y0 F{feed_rate}"
    ])

    return gcode, total_distance

def update_progress_from_position(real_pos, tracker, total_distance):
    dx = abs(real_pos[0] - tracker["x"])
    dy = abs(real_pos[1] - tracker["y"])

    tracker["distance"] += dx + dy

    tracker["x"] = real_pos[0]
    tracker["y"] = real_pos[1]

    if total_distance <= 0:
        return 0.0

    return min(
        100.0,
        round(
            (tracker["distance"] / total_distance) * 100,
            2
        )
    )

async def wait_if_paused():
    while currentStatus["isPaused"]:
        if _stop_spraying_flag:
            return False

        await asyncio.sleep(0.1)

    return True

async def run_spraying_algorithm(data: SprayingRequest):
    global _stop_spraying_flag

    _stop_spraying_flag = False

    _sync_connection_status()

    if not currentStatus["connected"]:
        currentStatus["lastMessage"] = (
            "Gagal mulai, mesin tidak terkoneksi."
        )
        return

    if (
        data.panjang > constraints["x"]
        or data.lebar > constraints["y"]
    ):
        currentStatus["lastMessage"] = (
            "Ukuran genteng melebihi batas area mesin."
        )
        return

    gcode_commands, total_distance = spraying_gcode(
        data.panjang,
        data.lebar,
        data.diameter,
        data.feed_rate
    )

    currentStatus.update({
        "isSpraying": True,
        "isPaused": False,
        "progress": 0.0
    })

    tracker = {
        "x": 0.0,
        "y": 0.0,
        "distance": 0.0
    }

    last_cmd = ""
    last_report = ""

    for cmd in gcode_commands:

        if _stop_spraying_flag:
            break

        if not await wait_if_paused():
            break

        ok, msg = con.send_command(cmd)

        if not ok:
            currentStatus["lastMessage"] = (
                f"Error saat eksekusi: {cmd}"
            )
            break

        last_cmd = cmd
        last_report = msg

        real_pos = con.get_grbl_status()

        if real_pos:
            currentStatus["position"] = real_pos

            currentStatus["progress"] = min(
                99.9,
                update_progress_from_position(
                    real_pos,
                    tracker,
                    total_distance
                )
            )

        currentStatus["lastMessage"] = (
            f"Mengeksekusi perintah: {cmd}"
        )

        currentStatus["lastReport"] = msg

        await asyncio.sleep(0.1)

    await monitor_completion(
        tracker,
        total_distance,
        last_cmd,
        last_report
    )

    if not _stop_spraying_flag:
        currentStatus["progress"] = 100.0
        currentStatus["lastMessage"] = (
            "Proses spraying selesai."
        )

    currentStatus["isSpraying"] = False
    currentStatus["isPaused"] = False

    for _ in range(50):  # max 10 detik
        status = con.get_grbl_status_full()
        print(f"[HOME POLL] {status}")
        if (
            status
            and status["state"] == "Idle"
            and status["pos"][0] == 0.0
            and status["pos"][1] == 0.0
            and status["pos"][2] == 0.0
        ):
            currentStatus["position"] = status["pos"]
            break
        await asyncio.sleep(0.2)

    con.reset_buffer()

async def monitor_completion(tracker, total_distance, last_cmd, last_report):
    while (
        currentStatus["progress"] < 100.0
        and not _stop_spraying_flag
    ):
        real_pos = con.get_grbl_status()

        if real_pos:
            currentStatus["position"] = real_pos

            currentStatus["progress"] = (
                update_progress_from_position(
                    real_pos,
                    tracker,
                    total_distance
                )
            )

        currentStatus["lastMessage"] = (
            f"Mengeksekusi perintah: {last_cmd}"
        )

        currentStatus["lastReport"] = last_report

        await asyncio.sleep(0.2)


# =================== CONTROL ALGORITHM ===================

def jog_machine(direction: str, step: float, feed: float):
    _sync_connection_status()

    x, y, z = currentStatus["position"]
    ok = False
    msg = ""

    axis = None
    sign = None
    current = None
    limit = None

    if direction == "X+":
        axis, sign, current, limit = "X", "+", x, constraints["x"]
    elif direction == "X-":
        axis, sign, current, limit = "X", "-", x, 0
    elif direction == "Y+":
        axis, sign, current, limit = "Y", "+", y, constraints["y"]
    elif direction == "Y-":
        axis, sign, current, limit = "Y", "-", y, 0
    elif direction == "Z+":
        axis, sign, current, limit = "Z", "+", z, constraints["z"]
    elif direction == "Z-":
        axis, sign, current, limit = "Z", "-", z, 0
    else:
        currentStatus["lastMessage"] = f"Direction tidak valid: {direction}"
        return currentStatus

    # Hitung step aktual sesuai constraint
    if sign == "+":
        allowed_step = max(0, limit - current)
        actual_step = min(step, allowed_step)
        target = current + actual_step
    else:
        allowed_step = max(0, current - 0)
        actual_step = min(step, allowed_step)
        target = current - actual_step

    if actual_step <= 0:
        currentStatus["lastMessage"] = f"Tidak bisa jog {direction}, sudah di batas constrain"
        return currentStatus

    ok, msg = con.jog_move(axis, target, feed)

    if not ok:
        currentStatus["lastMessage"] = msg
        return currentStatus

    if axis == "X":
        x = target
    elif axis == "Y":
        y = target
    elif axis == "Z":
        z = target

    currentStatus["position"] = [x, y, z]
    currentStatus["feed"] = feed
    currentStatus["lastMessage"] = f"Jog {direction} {actual_step}mm @ F{feed}"
    currentStatus["lastReport"] = msg

    _sync_connection_status()
    print("UPDATED:", currentStatus)

    return currentStatus

# =================== SETUP HANDLER ===================

def set_calibration(cx: float, cy: float, cz: float, feed: float):

    if cx < 0 or cy < 0 or cz < 0:
        currentStatus["lastMessage"] = "Koordinat tidak boleh negatif"
        return currentStatus

    if cx > constraints["x"] or cy > constraints["y"] or cz > constraints["z"]:
        currentStatus["lastMessage"] = "Koordinat melebihi constraint"
        return currentStatus

    # Trigger the actuator
    ok, msg = con.calib_move(cx, cy, cz, feed)

    if not ok:
        currentStatus["lastMessage"] = msg
        return currentStatus

    currentStatus["position"] = [cx, cy, cz]
    currentStatus["lastMessage"] = f"Jog to x{cx} y{cy} z{cz}"
    currentStatus["lastReport"] = msg

    return currentStatus

# Set the starting point (0, 0, 0)
def set_starting_point(zx: float, zy: float, zz: float):
    currentStatus["startPoint"] = True

    ok, msg = con.set_absolute_position()
    ok, msg = con.set_starting_point(zx, zy, zz)

    currentStatus["position"] = [zx, zy, zz]
    currentStatus["lastMessage"] = f"Set starting: x{zx} y{zy} z{zz}"
    currentStatus["lastReport"] = msg

    print("UPDATED:", currentStatus)
    
    return currentStatus

def to_starting_point(to_x:float, to_y:float, to_z:float, feed:float):

    # Clamp target biar aman
    to_x = max(0, min(to_x, constraints["x"]))
    to_y = max(0, min(to_y, constraints["y"]))
    to_z = max(0, min(to_z, constraints["z"]))

    ok, msg = con.go_to_zero(to_x, to_y, to_z, feed)

    # Update current position and speed
    currentStatus["position"] = [to_x, to_y, to_z]
    currentStatus["feed"] = feed
    currentStatus["lastMessage"] = f"Go to ZERO: {to_x} y{to_y} z{to_z}"
    currentStatus["lastReport"] = msg

    print("UPDATED:", currentStatus)
    
    return currentStatus

def emergency_stop():
    ok, msg = con.emergency_stop()

    # Update current position and speed
    currentStatus["isSpraying"] =  False
    currentStatus["isPaused"] = False
    currentStatus["connected"] =  False
    currentStatus["progress"] = 0
    currentStatus["lastMessage"] = msg
    currentStatus["emergency_stop"] = False

    print("UPDATED:", currentStatus)
    
    return currentStatus

# =================== STATUS  ===================
def get_status():
    _sync_connection_status()
    return currentStatus

def get_constraints():
    return constraints