// Compresses large localStorage values off the main thread for
// storage-codec.js, so saving the book never freezes the screen.
importScripts('lz-string.min.js');
self.onmessage = function (e) {
    const { id, str, mark } = e.data;
    let packed = null;
    try {
        const c = LZString.compressToUTF16(str);
        if (c.length + 4 < str.length && LZString.decompressFromUTF16(c) === str) packed = mark + c;
    } catch (err) { packed = null; }
    self.postMessage({ id, packed });
};
