import type Database from "better-sqlite3";
import type { RiskyWallets } from "@pumpfun/shared";

const LIMIT = 20;
const DAY = 86_400;

/** Rankings built only from what this site has traced and seen in the live feed. */
export function riskyWallets(db: Database.Database, now: number): RiskyWallets {
  const serialDevs = db
    .prepare(
      `SELECT dt.deployer AS wallet, SUM(dt.status = 'dead_dev_exited') AS dead, COUNT(*) AS total, MAX(t.created_at) AS lastAt
       FROM dev_tokens dt LEFT JOIN tokens t ON t.mint = dt.mint
       GROUP BY dt.deployer HAVING dead >= 2
       ORDER BY dead DESC, total DESC LIMIT ?`,
    )
    .all(LIMIT) as RiskyWallets["serialDevs"];
  const funders = db
    .prepare(
      `SELECT tw.wallet AS wallet, COUNT(DISTINCT dt.mint) AS deadLaunches, COUNT(DISTINCT t.deployer) AS devs
       FROM trace_wallets tw
       JOIN tokens t ON t.mint = tw.mint
       JOIN dev_tokens dt ON dt.deployer = t.deployer AND dt.status = 'dead_dev_exited'
       WHERE tw.role = 'funder'
       GROUP BY tw.wallet HAVING deadLaunches >= 2
       ORDER BY deadLaunches DESC, devs DESC LIMIT ?`,
    )
    .all(LIMIT) as RiskyWallets["funders"];
  const snipers = db
    .prepare(
      `SELECT wallet, COUNT(DISTINCT mint) AS launches FROM early_buyers WHERE slot_offset <= 2
       GROUP BY wallet HAVING launches >= 3 ORDER BY launches DESC LIMIT ?`,
    )
    .all(LIMIT) as RiskyWallets["snipers"];
  const launchers = db
    .prepare(
      `SELECT creator AS wallet, COUNT(*) AS launches, MAX(created_at) AS lastAt FROM feed_tokens WHERE created_at > ?
       GROUP BY creator HAVING launches >= 3 ORDER BY launches DESC LIMIT ?`,
    )
    .all(now - DAY, LIMIT) as RiskyWallets["launchers"];
  return { serialDevs, funders, snipers, launchers, generatedAt: now };
}
