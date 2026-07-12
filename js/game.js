'use strict';

// ══════════════════════════════════════════
//  DICE SVG GENERATOR
// ══════════════════════════════════════════
function getDiceSVG(value, selected, locked) {
  const dotPos = {
    1: [[50,50]],
    2: [[28,28],[72,72]],
    3: [[28,28],[50,50],[72,72]],
    4: [[28,28],[28,72],[72,28],[72,72]],
    5: [[28,28],[28,72],[50,50],[72,28],[72,72]],
    6: [[28,25],[28,50],[28,75],[72,25],[72,50],[72,75]]
  };
  const dots = dotPos[value] || [];
  let stroke, fill, dotColor, sw, glowDef = '';
  if (selected) {
    stroke = '#44e8a6'; fill = '#fff2c4'; dotColor = '#5a3500'; sw = 4;
    glowDef = '<filter id="g"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
  } else if (locked) {
    stroke = '#ec126e'; fill = '#ffe2a0'; dotColor = '#683a00'; sw = 3;
  } else {
    stroke = '#8a4d00'; fill = '#fff1c9'; dotColor = '#754200'; sw = 2.5;
  }
  const f = selected ? ' filter="url(#g)"' : '';
  return 'data:image/svg+xml,' + encodeURIComponent(
    `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs>${glowDef}</defs>` +
    `<rect width="100" height="100" rx="18" ry="18" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${f}/>` +
    dots.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="${selected?9:8}" fill="${dotColor}"${f}/>`).join('') +
    `</svg>`
  );
}

const BLANK_DIE_URL = "data:image/svg+xml," + encodeURIComponent(
  `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">` +
  `<rect width="100" height="100" rx="18" ry="18" fill="#3a0619" stroke="#ffd873" stroke-width="2.5"/>` +
  `<text x="50" y="66" font-size="40" text-anchor="middle" fill="#bd895a" font-family="monospace">?</text></svg>`
);

function setDieImg(el, value, selected, locked) {
  el.style.backgroundImage = value
    ? `url('${getDiceSVG(value, selected, locked)}')`
    : `url("${BLANK_DIE_URL}")`;
}

// ══════════════════════════════════════════
//  SHARED CONSTANTS
// ══════════════════════════════════════════
const ANTE      = 50;
const ROLL_COST = 10;
const MAX_ROLLS = 6;
const COLORS    = ['#e63e6d','#06d6a0','#f59e1b','#5cc8f5','#b06dff','#ff9a3c'];

// ══════════════════════════════════════════
//  MESSAGES
// ══════════════════════════════════════════
let msgTimer;
function showMsg(text, type='') {
  const box = document.getElementById('msgBox');
  box.textContent = text;
  box.className   = 'msg-box' + (type ? ' '+type : '');
  clearTimeout(msgTimer);
  if (type==='error'||type==='warn') msgTimer = setTimeout(()=>{ box.className='msg-box'; }, 3500);
}
