#!/usr/bin/env python

SWRC_SERVER = "wss://swrc.cloudmc.uk/realtime/"
VERSION = "v4.0.0"

import json
import asyncio
import hashlib
import random
import datetime
import enum
from websockets.asyncio.client import connect

def head_token():
    return hashlib.sha1(str(datetime.datetime.now().date().day).encode("utf-8")).hexdigest()

class Packet(enum.Enum):
    HELLO = 0x00
    HANDSHAKE = 0x01

    LINECROSS = 0x02
    PUSHTRACK = 0x03
    NEWRACE = 0x04
    UPDATE = 0x05
    MODIFYRACERS = 0x06
    MESSAGE = 0x07
    PITCROSS = 0x08
    RACESTATE = 0x09
    PITENTER = 0x10
    ENDRACE = 0x11
    SPEEDTRAP = 0x12
    DEBUGEVAL = 0x13
    TIMER = 0x14

    CREATENEWSESSION = 0x40
    NEWSESSION = 0x41
    ENDSESSION = 0x42
    NAMESESSION = 0x43,
    SESSIONS = 0x4f

    HEARTBEAT = 0xff

async def hello():
    async with connect(SWRC_SERVER + "?head=" + head_token()) as websocket:
        
        server_label = None
        sessions = []

        while True:
            message = await websocket.recv()

            packet_id = Packet(message[0])
            data = json.loads(message[1:])

            if packet_id == Packet.HELLO:
                server_label = data["server_label"]

            if packet_id == Packet.SESSIONS:
               sessions = list(data["sessions"].keys())
               break
        
        print("Connected to " + server_label)
        print(head_token())


        if len(sessions) == 0:
            print("No active sessions, come back later")
            exit(0)

        print("Please select a session")
        for i, session in enumerate(sessions):
            print(f"[{i}] {session}")

        while True:
            session_id = input("> ")

            if not session_id.isdigit():
                print("Please enter a valid session id")
                continue

            session_id = int(session_id)

            if session_id >= len(sessions):
                print("Not a valid session id")
                continue

            session = sessions[session_id]

            break
        
        print("Selected", session)

        print(SWRC_SERVER + session + "/racer?head=" + head_token())

        async with connect(SWRC_SERVER + session + "/racer?head=" + head_token()) as websocket:

            print("Sending handshake")
            await websocket.send(
                "\x00\x01" + json.dumps({
                    "username": "swrc_python_client_" + str(hex(random.getrandbits(32))[2:]),
                    "uuid": "169d2585-3e6a-4e8a-8e80-deaddeaddead",
                    "agent": "Python/SWRC",
                    "version": VERSION
                })
            )

            race_id = "none"
            race_track = "none"
            race_track_name = "none"
            
            while True:
                message = await websocket.recv()

                packet_id = Packet(message[0])
                data = json.loads(message[1:])

                if packet_id == Packet.NEWRACE:
                    race_id = data["race_id"]
                    race_track = data["track"]["id"]
                    race_track_name = data["track"]["name"]

                    print(f"Recieved new race! [{race_id}] at {race_track_name}")
                elif packet_id == Packet.UPDATE:
                    print(data["rc_clients"])

                    for row in data["race_leaderboard"]:
                        name = row["player_name"]
                        print(name, data["racer_laps"][name], data["racer_pits"][name])
                elif packet_id == Packet.HEARTBEAT:
                    pass
                else: print("S2C", packet_id, data)


if __name__ == "__main__":
    asyncio.run(hello())