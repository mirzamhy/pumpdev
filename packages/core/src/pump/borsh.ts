import { getBase58Decoder } from "@solana/kit";

const b58 = getBase58Decoder();
const utf8 = new TextDecoder();

/** Little-endian Borsh reader. Throws RangeError when data runs out. */
export class Reader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  private view(n: number): DataView {
    if (this.offset + n > this.bytes.length) throw new RangeError("borsh: out of data");
    const v = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, n);
    this.offset += n;
    return v;
  }

  u8(): number {
    return this.view(1).getUint8(0);
  }

  bool(): boolean {
    return this.u8() !== 0;
  }

  u32(): number {
    return this.view(4).getUint32(0, true);
  }

  u64(): bigint {
    return this.view(8).getBigUint64(0, true);
  }

  i64(): bigint {
    return this.view(8).getBigInt64(0, true);
  }

  skip(n: number): void {
    this.view(n);
  }

  take(n: number): Uint8Array {
    const v = this.view(n);
    return new Uint8Array(v.buffer, v.byteOffset, n);
  }

  pubkey(): string {
    return b58.decode(this.take(32));
  }

  string(): string {
    return utf8.decode(this.take(this.u32()));
  }
}
