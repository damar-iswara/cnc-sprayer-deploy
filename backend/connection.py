import serial
import time

PORT = "/dev/ttyUSB0"
BAUDRATE = 115200

serial_port = None
_last_port = PORT
_last_baudrate = BAUDRATE

# =================== CONNECTION HANDLER ===================
def connect(port_name=PORT, baudrate=BAUDRATE):
    global serial_port, _last_port, _last_baudrate
    _last_port = port_name
    _last_baudrate = baudrate

    try:
        if serial_port and serial_port.is_open:
            return True, f"Sudah terkoneksi ke {serial_port.port}"

        serial_port = serial.Serial(port_name, baudrate, timeout=1)
        
        # bangunin GRBL
        serial_port.write(b"\r\n\r\n")
        time.sleep(2)
        serial_port.reset_input_buffer()

        # unlock alarm
        serial_port.write(b"$X\n")
        time.sleep(1)

        return True, f"Berhasil connect ke {port_name}"
    except Exception as e:
        serial_port = None
        return False, f"Error koneksi: {e}"

def disconnect():
    global serial_port

    if serial_port and serial_port.is_open:
        serial_port.close()
        serial_port = None
        return True, "Disconnected"

    return False, "No active connection"

def auto_reconnect():
    global serial_port
    if not is_connected():
        print(f"Attempting to reconnect to {_last_port} at {_last_baudrate} baud...")
        ok, _ = connect(_last_port, _last_baudrate)
        return ok
    return True

def is_connected():
    return serial_port is not None and serial_port.is_open

# ------------ COMMAND SENDING -----------------
def send_command(cmd: str):
    global serial_port

    if not is_connected():
        if not auto_reconnect():
            return False, "Serial port tidak terkoneksi"

    try:
        full_cmd = f"{cmd}\n"
        serial_port.write(full_cmd.encode())
        print(f"Sent: {cmd}")

        res = serial_port.readline().decode(errors="ignore").strip()
        if res:
            print(f"Response: {res}")

        return True, (res or "ok")
    except Exception as e:
        print(f"Error sending command: {e}")
        if serial_port:
            try:
                serial_port.close()
            except:
                pass
            serial_port = None
        return False, f"Gagal kirim command: {e}"

# =================== MOVEMENT COMMANDS ===================

def jog_move(axis: str, target: float, feed: float):
    cmd = f"G0 {axis}{target} F{feed}"
    return send_command(cmd)

def calib_move(cx, cy, cz, feed):
    calib_cmd = f"G1 X{cx} Y{cy} Z{cz} F{feed}"
    return send_command(calib_cmd)

def set_starting_point(zx, zy, zz):
    set_zero_cmd = f"G92 X{zx} Y{zy} Z{zz}"
    return send_command(set_zero_cmd)

def go_to_zero(to_x, to_y, to_z, feed):
    home_cmd = f"G1 X{to_x} Y{to_y} Z{to_z} F{feed}"
    return send_command(home_cmd)

def set_absolute_position():
    home_cmd = "G90"
    return send_command(home_cmd)
    
def emergency_stop():
    global serial_port

    serial_port.write(b"\x18")
    print("Emergency stop sent, waiting for machine to halt...")
    time.sleep(1)

    serial_port.reset_input_buffer()

    print("Resetting machine state...")
    return send_command("$X")

# =================== PAUSE-RESUME COMMANDS ===================

def pause():
    global serial_port
    if not is_connected():
        return False, "Serial port tidak terkoneksi"
    try:
        serial_port.write(b"!")
        time.sleep(0.1)
        return True, "Pause sent"
    except Exception as e:
        return False, f"Gagal Pause:{e}"
    
def resume():
    global serial_port
    if not is_connected():
        return False, "Serial port tidak terkoneksi"
    try:
        serial_port.write(b"~")
        time.sleep(0.1)
        return True, "Resume sent"
    except Exception as e:
        return False, f"Gagal Resume:{e}"
    