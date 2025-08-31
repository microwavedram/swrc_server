import math

def fractional_part(value: float) -> float:
    """Return the fractional part of a number."""
    return value - math.floor(value)

def get_sky_angle(time_of_day: int, fixed_time: int | None = None) -> float:
    """
    Compute the normalized sky angle based on Minecraft's logic.

    Args:
        time_of_day (int): The current in-game time in ticks (0–23999).
        fixed_time (int | None): Optional override to lock the time.

    Returns:
        float: Sky angle in [0.0, 1.0].
               0.0 = sunrise, 0.25 = noon, 0.5 = sunset, 0.75 = midnight
    """
    time = (fixed_time if fixed_time is not None else time_of_day) / 24000.0 - 0.25
    d = fractional_part(time)
    e = 0.5 - math.cos(d * math.pi) / 2.0
    return (d * 2.0 + e) / 3.0

print(math.cos(get_sky_angle(7000)))