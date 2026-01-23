export type Surface = {
  name: "tarmac" | "gravel" | "dirt" | "offtrack";
  frictionMu: number;
  rollingResistanceN: number;
};

export function surfaceForTrackSM(totalLengthM: number, sM: number, offTrack: boolean): Surface {
  if (offTrack) {
    return { name: "offtrack", frictionMu: 0.58, rollingResistanceN: 1100 };
  }

  const t = (sM % totalLengthM) / totalLengthM;
  if (t < 0.16) return { name: "tarmac", frictionMu: 1.05, rollingResistanceN: 260 };
  if (t < 0.34) return { name: "gravel", frictionMu: 0.80, rollingResistanceN: 520 };
  if (t < 0.52) return { name: "tarmac", frictionMu: 1.0, rollingResistanceN: 280 };
  if (t < 0.74) return { name: "dirt", frictionMu: 0.70, rollingResistanceN: 650 };
  if (t < 0.86) return { name: "gravel", frictionMu: 0.78, rollingResistanceN: 560 };
  return { name: "tarmac", frictionMu: 1.02, rollingResistanceN: 270 };
}
