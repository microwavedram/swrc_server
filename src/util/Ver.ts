export const semverToInt = (semver: string): number =>
	parseInt(
		semver
			.replace(/[^\d.]/g, "")
			.split(".")
			.join("")
	)
