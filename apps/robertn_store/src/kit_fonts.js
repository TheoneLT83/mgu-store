'use strict';
/**
 * The kit's fonts API (get, measure, setLook) over the Store's own glyph atlases:
 * Inter (SIL OFL 1.1, src/LICENSE-Inter.txt), baked by tools/bake_fonts.py
 * into src/font_regular.js and src/font_semibold.js. The kit's family
 * names map onto them: label and light the regular face, bold, num and gear
 * the semibold one.
 */
const zlib = require('zlib');

// per look (store_ui.js LOOKS): the iDrive 8 look draws with Inter, the iDrive 7 look with the Ubuntu font
// condensed, as the idrive7-apps kit does (Ubuntu Font Licence 1.0, src/LICENSE-Ubuntu-font.txt). A face's
// atlases load on first use.
const FACES = {
    id8: { regular: () => require('./font_regular.js'), semibold: () => require('./font_semibold.js') },
    id7: { regular: () => require('./font_id7_regular.js'), semibold: () => require('./font_id7_semibold.js') }
};
const FAMILY = { label: 'regular', light: 'regular', bold: 'semibold', num: 'semibold', gear: 'semibold' };
const families = Object.create(null);
let look = 'id8';

/** The look whose faces get() picks from: 'id7' or 'id8' (any other: 'id8'). */
function setLook(l) {
    look = FACES[l] ? l : 'id8';
}

function family(name) {
    const face = FAMILY[name] || 'regular';
    const key = look === 'id8' ? face : `${look}-${face}`;
    if (!families[key]) {
        families[key] = FACES[look][face]().sizes.map((s) => ({
            size: s.size, ascent: s.ascent, descent: s.descent, atlasW: s.atlasW, atlasH: s.atlasH,
            glyphs: s.glyphs, _alpha: s.alpha, alpha: null, face: look === 'id8' ? null : key
        }));
    }
    return families[key];
}

/** Smallest baked size >= requested (downscaling looks better), else largest. */
function get(name, size) {
    const fam = family(name);
    let best = null;
    for (const f of fam) {
        if (f.size >= size && (!best || f.size < best.size)) {
            best = f;
        }
    }
    if (!best) {
        best = fam[fam.length - 1];
    }
    if (!best.alpha) {
        best.alpha = zlib.inflateSync(Buffer.from(best._alpha, 'base64'));
    }
    return best;
}

function measure(f, s) {
    let w = 0;
    for (const ch of s) {
        const g = f.glyphs[ch.codePointAt(0)] || f.glyphs[63];
        if (g) {
            w += g[6];
        }
    }
    return w;
}

module.exports = { get, measure, setLook };
