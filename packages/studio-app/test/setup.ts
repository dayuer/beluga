import Module from 'node:module';
import lucideMock from './lucide-mock';
import * as rnMock from './rn-mock';
import * as svgMock from './svg-mock';

const g = globalThis as Record<string, unknown>;
if (!g.expo) {
  g.expo = {
    EventEmitter: class {
      addListener() {
        return { remove() {} };
      }
      removeAllListeners() {}
      emit() {}
    },
    NativeModule: class {},
    SharedObject: class {},
  };
}

const mod = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const origLoad = mod._load.bind(Module);
mod._load = (request: string, parent: unknown, isMain: boolean) => {
  if (request === 'react-native' || request.startsWith('react-native/')) return rnMock;
  if (request === 'react-native-svg' || request.startsWith('react-native-svg/')) return svgMock;
  if (request === 'lucide-react-native') return lucideMock;
  return origLoad(request, parent, isMain);
};
