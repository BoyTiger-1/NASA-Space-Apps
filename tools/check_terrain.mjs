import { dem, fullStack } from './terrain_node.mjs';
import { TerrainStack, computeHorizon } from '../js/terrain.js';
const D=Math.PI/180; const q=(la,lo)=>[Math.cos(la*D)*Math.cos(lo*D),Math.cos(la*D)*Math.sin(lo*D),Math.sin(la*D)];
const g=dem('g64');
for (const nm of ['s20','s40','s80','s120','n120']) { const d=dem(nm); let s=0,m=0,c=0;
  for (let i=0;i<4000;i++){ const lat=(nm[0]=='s'?-1:1)*(90-Math.random()*(nm=='s20'?2.3:nm=='s40'?4.8:nm=='s80'?9.5:14)); const lon=Math.random()*360; const v=q(lat,lon); const a=d.height(...v), b=g.height(...v); if(a!==a) continue; s+=(a-b)**2; m+=a-b; c++; }
  console.log(nm,'vs g64: n',c,'rms diff m',Math.sqrt(s/c).toFixed(1),'mean',(m/c).toFixed(1)); }
const T=fullStack();
console.log('Shackleton floor (-89.67,129.78):',T.heightLL(-89.67,129.78).toFixed(0),' ridge site (-89.45,-137.31):',T.heightLL(-89.45,-137.31).toFixed(0),' Apollo 11:',T.heightLL(0.67416,23.47314).toFixed(0), ' Malapert massif (-85.99,2.93):',T.heightLL(-85.99,2.93).toFixed(0));
let t=Date.now(); const h=computeHorizon(T,-89.45,-137.31,2); console.log('horizon ms',Date.now()-t,'min',Math.min(...h.el).toFixed(2),'max',Math.max(...h.el).toFixed(2));
