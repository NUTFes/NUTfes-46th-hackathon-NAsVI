import source from '../../../concept-design/api/openapi.yaml?raw';
import { parseOpenApi } from '../../../tools/contract/openapi';

// Vite が文字列を埋め込むので workerd でも fs は不要。
export const spec = parseOpenApi(source);
