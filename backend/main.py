import asyncio
import serial.tools.list_ports

# FastAPI: Handling komunikasi ke python, WebSocket: for real time communication
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# Module Lokal
from backend import machine as mcn
from backend import connection as con
from backend.machine import ConnectRequest, JogRequest, SetCalibration, SetStartingPoint, ToStartingPoint, SprayingRequest

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="frontend"), name="static")

@app.get("/")
def root():
    return FileResponse("frontend/index.html")


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            await ws.send_json(mcn.get_status())
            # await ws.send_json(mcn.get_constraints())
            await asyncio.sleep(0.2)
    except WebSocketDisconnect:
        print("Client disconnected from WebSocket")


@app.get("/status")
def status():
    return mcn.get_status()

@app.post("/connect")
def connect_machine(data: ConnectRequest):
    ok, msg = con.connect(data.port, data.baudrate)
    
    mcn.set_starting_point(0, 0, 0)

    status = mcn.get_status()
    status["connected"] = con.is_connected()
    status["lastMessage"] = msg
    return {
        "success": ok,
        "message": msg,
        "status": status,
    }

@app.post("/disconnect")
def disconnect_machine():
    ok, msg = con.disconnect()
    status = mcn.get_status()
    status["connected"] = con.is_connected()
    status["lastMessage"] = msg
    return {
        "success": ok,
        "message": msg,
        "status": status,
    }

@app.get("/ports")
def list_ports():
    ports = serial.tools.list_ports.comports()
    return [
        {"device": p.device, "description": p.description}
        for p in ports
        if p.device.startswith("/dev/ttyUSB")
    ]

@app.post("/jog")
def jog(data: JogRequest):
    print("JOG REQUEST:", data)
    return mcn.jog_machine(data.direction, data.step, data.feed)

@app.post("/calibration")
def calibration(data: SetCalibration):
    print("CALIBRATION REQUEST:", data)
    return mcn.set_calibration(data.cx, data.cy, data.cz, data.feed)

@app.post("/set-starting-point")
def setStartingPoint(data: SetStartingPoint):
    print("SET START REQUEST:", data)
    return mcn.set_starting_point(data.zx, data.zy, data.zz)

@app.post("/back-to-start")
def toStartingPoint(data: ToStartingPoint):
    print("TO START REQUEST:", data)
    return mcn.to_starting_point(data.to_x, data.to_y, data.to_z, data.feed)

@app.post("/emergency-stop")
def emergencyStop():
    print("EMERGENCY STOP REQUEST:")
    return mcn.emergency_stop()

@app.post("/start-spraying")
def startSpraying(data: SprayingRequest, background_tasks: BackgroundTasks):
    print("START SPRAYING REQUEST:", data)
    background_tasks.add_task(
        mcn.run_spraying_algorithm,
        data
    )
    return {"success": True, "message": "Algoritma spraying berhasil dijalankan di background."}

@app.post("/pause-spraying")
def pause_spraying():
    print("PAUSE REQUEST")
    return mcn.pause_process()

@app.post("/resume-spraying")
def resume_spraying():
    print("RESUME REQUEST")
    return mcn.resume_process()