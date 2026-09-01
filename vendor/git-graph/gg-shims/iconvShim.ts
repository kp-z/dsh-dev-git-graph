// iconv-lite shim：ESM 下走 CJS interop（cjs-module-lexer 解析不了 iconv-lite 的导出）。
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const iconv = req('iconv-lite') as {
	decode: (buffer: Buffer, encoding: string) => string;
	encodingExists: (encoding: string) => boolean;
};

export const decode = iconv.decode;
export const encodingExists = iconv.encodingExists;
