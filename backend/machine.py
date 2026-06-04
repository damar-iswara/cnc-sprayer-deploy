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
    # panjang = panjang - 1
    # lebar = lebar - 1
    gcode_list = []
    gcode_list.append("G90")
    gcode_list.append(f"G1 X0 Y0 F{feed_rate}")

    current_y = 0.0
    direction = 1
    total_distance = 0.0  # <--- Variabel penyimpan total panjang jalur mekanis
    
    # Titik koordinat awal nosel
    last_x, last_y = 0.0, 0.0

    line = math.ceil(lebar / diameter) if diameter > 0 else 1
    step_over = math.floor(lebar / line) if line > 0 else diameter

    gcode_list.append("M3")

    while current_y <= lebar:
        # 1. Tentukan target sapuan X
        target_x = panjang if direction == 1 else 0.0
        gcode_list.append(f"G1 X{target_x} Y{current_y} F{feed_rate}")
        
        # Hitung jarak sapuan horizontal
        total_distance += abs(target_x - last_x)
        last_x = target_x
        
        # 2. Geser sumbu Y ke baris berikutnya
        current_y += step_over

        # 3. Jalankan manuver belok sudut jika posisi masih di dalam area genteng
        if current_y <= lebar:
            gcode_list.append(f"G1 X{last_x} Y{current_y} F{feed_rate}")
            
            # Hitung jarak geser vertikal belokan
            total_distance += abs(current_y - last_y)
            last_y = current_y

        direction *= -1

    gcode_list.append("M5")
    gcode_list.append(f"G1 X0 Y0 F{feed_rate}")

    # con.reset_buffer()  # Pastikan buffer bersih sebelum mulai eksekusi

    return gcode_list, total_distance  # <--- Kembalikan list dan nilai total jaraknya

async def run_spraying_algorithm(data: SprayingRequest):
    global _stop_spraying_flag
    _stop_spraying_flag = False
    
    _sync_connection_status()
    if not currentStatus["connected"]:
        currentStatus["lastMessage"] = "Gagal mulai, mesin tidak terkoneksi."
        return

    if data.panjang > constraints["x"] or data.lebar > constraints["y"]:
        currentStatus["lastMessage"] = "Ukuran genteng melebihi batasan maksimum area mesin!"
        return

    # Ambil list perintah dan total jarak absolut program semprot
    gcode_commands, total_distance = spraying_gcode(data.panjang, data.lebar, data.diameter, data.feed_rate)
    
    currentStatus["isSpraying"] = True
    currentStatus["isPaused"] = False
    currentStatus["progress"] = 0.0
    
    distance_travelled = 0.0  # <--- Variabel pelacak jarak yang sudah dilewati
    last_tracked_x, last_tracked_y = 0.0, 0.0

    for cmd in gcode_commands:
        if _stop_spraying_flag:
            break
        
        while currentStatus["isPaused"]:
            if _stop_spraying_flag:
                break
            await asyncio.sleep(0.1)

        if _stop_spraying_flag:
            break

        ok, msg = con.send_command(cmd)
        if not ok:
            currentStatus["lastMessage"] = f"Error saat eksekusi: {cmd}. Loop dibatalkan."
            break

        # Ambil koordinat fisik mesin terbaru dari GRBL (?) status query
        real_pos = con.get_grbl_status()
        if real_pos:
            currentStatus["position"] = real_pos
            
            # Akumulasikan jarak tempuh real berdasarkan pergerakan nosel terakhir
            dx = abs(real_pos[0] - last_tracked_x)
            dy = abs(real_pos[1] - last_tracked_y)
            distance_travelled += (dx + dy)
            
            # Update referensi titik pelacakan terakhir
            last_tracked_x, last_tracked_y = real_pos[0], real_pos[1]

            # RUMUS BARU: Persentase naik smooth merayap sepanjang jalur gerak nosel
            if total_distance > 0:
                calc_progress = (distance_travelled / total_distance) * 100
                currentStatus["progress"] = min(99.9, max(0.0, round(calc_progress, 2)))

        currentStatus["lastMessage"] = f"Mengeksekusi perintah mesin: {cmd}"
        currentStatus["lastReport"] = msg
        
        await asyncio.sleep(0.1)

    # Loop monitoring akhir untuk memastikan nosel benar-benar sampai (0,0) sebelum ditutup
    while currentStatus["progress"] < 100.0 and not _stop_spraying_flag:
        real_pos = con.get_grbl_status()
        if real_pos:
            currentStatus["position"] = real_pos
            dx = abs(real_pos[0] - last_tracked_x)
            dy = abs(real_pos[1] - last_tracked_y)
            distance_travelled += (dx + dy)
            last_tracked_x, last_tracked_y = real_pos[0], real_pos[1]
            
            if total_distance > 0:
                calc_progress = (distance_travelled / total_distance) * 100
                # [PERBAIKAN]: Jika sudah lewat atau sama dengan total jalur semprot, langsung set 100%
                if calc_progress >= 100.0:
                    currentStatus["progress"] = 100.0
                    currentStatus["isSpraying"] = False # Status spraying selesai secara fungsional
                else:
                    currentStatus["progress"] = round(calc_progress, 2)

        currentStatus["lastMessage"] = f"Mengeksekusi perintah mesin: {cmd}"
        currentStatus["lastReport"] = msg
        await asyncio.sleep(0.2)

    if not _stop_spraying_flag:
        currentStatus["progress"] = 100.0
        currentStatus["lastMessage"] = "Proses spraying genteng SELESAI dengan sukses!"
    
    currentStatus["isSpraying"] = False
    currentStatus["isPaused"] = False
    con.reset_buffer()  # Pastikan buffer bersih setelah eksekusi

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