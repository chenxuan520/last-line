interface Body {
  json<Value>(): Promise<Value>;
}

interface SubtleCrypto {
  timingSafeEqual(left: ArrayBufferView | ArrayBuffer, right: ArrayBufferView | ArrayBuffer): boolean;
}
