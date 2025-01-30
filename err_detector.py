import re
import json

events = []

with open("swrc.log") as f:
    for line in f.read().split("\n"):

        if "RC VERBOSE " in line and not "HEAD-TOKEN" in line and len(line) > 20 and "timestamp" in line and "checkpoint_crosses" in line:
            events.append(json.loads(line[40:]))


events = sorted(events, key=lambda key: key["timestamp"])

print("hi")

last_checkpoints = {}

for event in events:
    if "timestamp" in event:
        # print(event)
        for checkpointid, crosses in event["checkpoint_crosses"].items():
            for cross in crosses:
                if not cross in last_checkpoints:
                    last_checkpoints[cross] = -1

                if int(checkpointid) != (last_checkpoints[cross] + 1) % 7:
                    # print("miscount", cross, "-", checkpointid, last_checkpoints[cross])
                    pass

                if int(checkpointid) == 1 and last_checkpoints[cross] > 1:
                    print("lapdown", cross)

                
                last_checkpoints[cross] = int(checkpointid)
