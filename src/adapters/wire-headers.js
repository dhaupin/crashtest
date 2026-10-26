// Node-side header storage legitimately holds ARRAY values (multi
// set-cookie via getHeaders()/light-my-request res.headers) and Buffers
// (binary values written raw). The WHATWG Response header init refuses
// both - doubling down on the constructor mid-route would misgrade a
// working handler's honest multi-value header as a transport crash.
// Synthesis therefore normalizes: an array rides as its comma-joined
// form (the one fake-transport caveat: do not ext-quote cookie values
// out - the joining is byte-truthful for single-value arrays; multi
// set-cookie reads that need true pairing are a target's real lane, not
// the adapter's), a Buffer/Blob rides as its utf-8 text, null rides as
// an empty string (an unset value is an unset header - never "null").
export function wireHeaders(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    let value = v;
    if (Array.isArray(value)) value = value.join(', ');
    else if (value !== null && typeof value === 'object') value = String(value);
    else if (value === null || value === undefined) value = '';
    out[k.toLowerCase()] = value;
  }
  return out;
}
