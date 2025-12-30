export const PROTOCOL = 310

export const enum Packets {
	/* $swrc */ HELLO = 0x00,
	/* $swrc */ HANDSHAKE = 0x01,

	/* $rc */ LINECROSS = 0x02,
	/* $rc */ PUSHTRACK = 0x03,
	/* $racer */ NEWRACE = 0x04,
	/* $racer */ UPDATE = 0x05,
	/* $rc */ MODIFYRACERS = 0x06,
	/* $racer */ MESSAGE = 0x07,
	/* $rc */ PITCROSS = 0x08,
	/* $rc $racer */ RACESTATE = 0x09,
	/* $rc */ PITENTER = 0x10,
	/* $rc $racer */ ENDRACE = 0x11,
	/* $rc */ SPEEDTRAP = 0x12,
	/* $rc */ DEBUGEVAL = 0x13,
	/* $rc */ TIMER = 0x14,
	/* $rc */ POP_FLAP = 0x15,
	/* $rc */ REORDER = 0x16,
	/* $rc */ TOGGLE_TRACKING = 0x17,

	/* $swrc */ CREATENEWSESSION = 0x40,
	/* $swrc */ NEWSESSION = 0x41,
	/* $swrc */ ENDSESSION = 0x42,
	/* $swrc */ NAMESESSION = 0x43,
	/* $swrc */ SESSIONS = 0x4f,

	/* $rc $racer */ HEARTBEAT = 0xff,
}
