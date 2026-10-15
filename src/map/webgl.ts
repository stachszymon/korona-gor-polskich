/** True when the browser can create the WebGL2 context MapLibre GL needs. */
export function supportsWebGL(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}
