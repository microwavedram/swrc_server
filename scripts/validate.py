import sys
import os

def validate_race(filename, max_checkpoint_index, lap_total):
    print(f"🔍 Validating race: {filename}")
    
    if not os.path.exists(filename):
        print("❌ File not found!")
        return
    
    with open(filename) as f:
        lines = [line.strip() for line in f if line.strip()]

    players = set()
    player_checkpoints = {}
    seen_events = set()
    errors = 0

    for line_no, line in enumerate(lines, 1):
        parts = line.split()
        if len(parts) < 2:
            continue

        timestamp = parts[0]
        tag = parts[1]

        if tag == "PLAYER":
            if parts[2] == "ADD":
                player = parts[3]
                if player in players:
                    print(f"[Line {line_no}] ⚠️ Player '{player}' added twice.")
                players.add(player)
                player_checkpoints[player] = []
            elif parts[2] == "REMOVE":
                player = parts[3]
                players.discard(player)
                player_checkpoints.pop(player, None)
        
        elif tag == "CHECKPOINT":
            if len(parts) < 4:
                print(f"[Line {line_no}] ❌ Malformed CHECKPOINT line: {line}")
                errors += 1
                continue
            
            checkpoint = int(parts[2])
            player = parts[3]

            if player not in players:
                print(f"[Line {line_no}] ❌ Player '{player}' used before being added.")
                errors += 1
                continue

            key = (player, checkpoint, timestamp)
            if key in seen_events:
                print(f"[Line {line_no}] ⚠️ Duplicate checkpoint event: {key}")
            seen_events.add(key)

            # Append and then check ordering
            history = player_checkpoints[player]
            if history:
                prev = history[-1]
                if max_checkpoint_index != 0 and checkpoint < (prev[1] % max_checkpoint_index):
                    print(f"[Line {line_no}] ❌ {player} regressed: {prev % max_checkpoint_index} → {checkpoint}")
                    errors += 1
            player_checkpoints[player].append(
                (int(timestamp), checkpoint)
            )

    for player, checkpoints in player_checkpoints.items():
        full_splits = [c for _, c in checkpoints]
        total_laps = len([c for i, c in enumerate(full_splits[:-1]) if full_splits[i+1] < full_splits[i]])
        if total_laps < lap_total:
            print(f"⏳ {player} only completed {total_laps} laps (expected {lap_total})")
    
    if errors == 0:
        print("✅ No critical issues found.")
    else:
        print(f"❌ {errors} error(s) detected.")

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: validate_race.py <race_file> <max_checkpoint_index> <lap_total>")
        sys.exit(1)

    race_file = sys.argv[1]
    max_checkpoint_index = int(sys.argv[2])
    lap_total = int(sys.argv[3])

    validate_race(race_file, max_checkpoint_index, lap_total)
