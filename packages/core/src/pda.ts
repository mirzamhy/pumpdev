import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { PUMP_PROGRAM_ID } from "./pump/constants";

export async function bondingCurvePda(mint: string): Promise<string> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(PUMP_PROGRAM_ID),
    seeds: ["bonding-curve", getAddressEncoder().encode(address(mint))],
  });
  return pda;
}
