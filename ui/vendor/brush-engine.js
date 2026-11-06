// Brush model. build.py inlines this file into every page after the page has declared S (the
// strokes) and CFG (base, speed, gap, ink); it reads CFG.ink at load, so that order is required.
// Each stroke is a filled outline: the KanjiVG centerline offset on both sides by a half-width
// that follows the stroke type, plus brush footprints where the brush presses (entry, corners,
// hook, stop), then dry-brush streaks cut out.
const TAU=Math.PI*2,TIP=-Math.PI*.75,STEP=.25,DR=[Math.SQRT1_2,Math.SQRT1_2],INK=CFG.ink;
// Edge bleed is the ink at half strength, so a colored ink blurs into its own tint.
const INK_EDGE=(h=>{const n=parseInt(h.slice(1),16);return`rgba(${n>>16&255},${n>>8&255},${n&255},.5)`})(INK);
const smooth=(a,b,x)=>{x=Math.min(1,Math.max(0,(x-a)/(b-a)));return x*x*(3-2*x)};
const angDiff=(a,b)=>{let d=a-b;while(d>Math.PI)d-=TAU;while(d<-Math.PI)d+=TAU;return d};
function rng(seed){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let x=Math.imul(seed^seed>>>15,1|seed);x=x+Math.imul(x^x>>>7,61|x)^x;return((x^x>>>14)>>>0)/4294967296}}
function noise1(seed){const r=rng(seed),v=Array.from({length:256},()=>r()*2-1);return x=>{const i=Math.floor(x),f=x-i,u=f*f*(3-2*f);return v[i&255]+(v[(i+1)&255]-v[i&255])*u}}
// Stroke family from the KanjiVG type: how it starts, runs and ends.
function kind(type,L){
  const t=type.split("/").pop();
  if(/[㇆㇚㇟㇂]/.test(t))return"hook";
  if(t[0]==="㇔")return"dot";
  if(t[0]==="㇒")return"left";
  if(t[0]==="㇏")return L<12?"dot":"right";
  return"stop";
}
const NS="http://www.w3.org/2000/svg",probe=document.createElementNS(NS,"svg");
probe.setAttribute("width","0");probe.setAttribute("height","0");probe.style.position="absolute";document.body.appendChild(probe);
function build([type,d],idx){
  const path=document.createElementNS(NS,"path");path.setAttribute("d",d);probe.appendChild(path);
  const L0=path.getTotalLength(),k=kind(type,L0),L=k==="dot"?Math.min(L0,Math.max(3.5,L0*.7)):L0,n=Math.max(8,Math.ceil(L/STEP)),ds=L/n,pts=[],u2i=x=>Math.round(x/ds);
  for(let i=0;i<=n;i++){const a=path.getPointAtLength(L*i/n);pts.push({x:a.x,y:a.y})}
  const dirAt=(i,lo,hi)=>{const a=pts[Math.max(lo,i-2)],b=pts[Math.min(hi,i+2)];return Math.atan2(b.y-a.y,b.x-a.x)};
  const A=pts.map((_,i)=>dirAt(i,0,n));
  // Hook: the tail after the last change of direction, flicked out quickly.
  let hook=-1;
  if(k==="hook"){
    const ae=Math.atan2(pts[n].y-pts[n-4].y,pts[n].x-pts[n-4].x);let i=n-4;
    while(i>0&&Math.abs(angDiff(A[i],ae))<.6)i--;
    hook=Math.max(n-u2i(8),Math.min(i,n-u2i(1.5)));
  }
  // Corners (折れ): sharp turns of the centerline.
  const W=Math.max(2,u2i(1.4)),corners=[];
  if(k==="stop"||k==="hook"){
    let run=null;
    for(let i=W;i<=n-W;i++){
      const tr=Math.abs(angDiff(A[i+W],A[i-W]));
      if(tr>.75){if(!run)run={bi:i,v:tr};else if(tr>run.v){run.bi=i;run.v=tr}}
      else if(run){corners.push(run.bi);run=null}
    }
    if(run)corners.push(run.bi);
  }
  const cs=corners.filter(c=>c>u2i(3)&&c<n-u2i(3)&&(hook<0||Math.abs(c-hook)>2*W));
  const cuts=[0,...cs,...(hook>=0?[hook]:[]),n].sort((a,b)=>a-b),segs=[],la=new Array(n+1);
  for(let j=0;j<cuts.length-1;j++){
    const sg={a:cuts[j],b:cuts[j+1],nx:[],ny:[]};
    for(let i=sg.a;i<=sg.b;i++){const g=dirAt(i,sg.a,sg.b);la[i]=g;sg.nx.push(-Math.sin(g));sg.ny.push(Math.cos(g))}
    segs.push(sg);
  }
  // Half-width along the stroke, in units of the page's brush size.
  const nz=noise1(idx*131+7),nA=noise1(idx*131+8),nB=noise1(idx*131+9),wA=[],wB=[];
  let wh=0;
  for(let i=0;i<=n;i++){
    const t=i/n,s=i*ds,dirF=.82+.33*Math.abs(Math.sin(la[i]));let w;
    if(k==="stop"||k==="hook")w=dirF*(1-(.05+.08*Math.abs(Math.cos(la[i])))*Math.sin(Math.PI*t)); // verticals heavier than horizontals; horizontals thin in the middle
    else if(k==="left")w=1.06*Math.pow(1-smooth(.15,1.02,t),1.15)+.02; // full, then lifting away to a point
    else if(k==="right")w=.32+1.13*smooth(0,.8,t); // light entry, pressing down toward the foot
    else w=.6+.5*smooth(0,.7,t); // dot: tip first, then the press (the dot is shortened to its pressed part)
    for(const c of cs){const e=(c-i)*ds;if(e>0&&e<2.5)w*=1-.07*Math.sin(Math.PI*e/2.5)} // the lift before a turn
    if(hook>=0){if(i===hook)wh=w;if(i>hook){const u=(i-hook)/(n-hook);w=wh*.9*Math.pow(1-u,.8)}}
    let a=w,b=w;
    if(k==="right"){const u=smooth(.8,1,t);a=w*(1-Math.pow(u,1.8));b=w*(1-Math.pow(u,.55))} // flat lower edge, knife tip
    const g=(1+.05*nz(s*.22))*CFG.base;
    wA.push(a*g*(1+.03*nA(s*1.1)));wB.push(b*g*(1+.03*nB(s*1.1)));
  }
  const wAt=i=>(wA[i]+wB[i])/2,feet=[];
  // 起筆: the tip lands toward the upper left and the belly presses down-right, giving the angled head.
  // The body behind the cut is clipped away, so the head ends in a slanted edge, not a round cap.
  let cut=null;
  {
    const R=wAt(0)*(k==="right"?1.15:k==="dot"?.9:1),x=pts[0].x+DR[0]*.25*R,y=pts[0].y+DR[1]*.25*R,el=1.45;
    feet.push({i:0,x,y,R,el,tip:1.25});
    const g=A[Math.min(n,u2i(1.5))],m=-Math.SQRT1_2*Math.cos(g)+Math.SQRT1_2*Math.sin(g);
    if(k!=="dot"&&Math.abs(m)>.3){const sg=Math.sign(m),b=R/el*.5;cut={x:x+sg*Math.SQRT1_2*b,y:y-sg*Math.SQRT1_2*b,sg}}
  }
  // 折れ: lift, step out to the shoulder, press again on the new direction.
  for(const c of cs){
    const i1=Math.max(0,c-W),i2=Math.min(n,c+W);
    let ux=pts[c].x-pts[i1].x,uy=pts[c].y-pts[i1].y,vx=pts[i2].x-pts[c].x,vy=pts[i2].y-pts[c].y;
    const l1=Math.hypot(ux,uy)||1,l2=Math.hypot(vx,vy)||1;ux/=l1;uy/=l1;vx/=l2;vy/=l2;
    let ox=ux-vx,oy=uy-vy;const lo=Math.hypot(ox,oy)||1;ox/=lo;oy/=lo;
    const R=wAt(Math.min(n,c+u2i(1.5)))*(ux*vy-uy*vx>0?1.06:1);
    feet.push({i:c,x:pts[c].x+ox*.12*R,y:pts[c].y+oy*.12*R,R,el:1.3,tip:1});
  }
  // はね: stop and gather the brush before the flick.
  if(hook>=0){const R=wAt(hook)*1.1;feet.push({i:hook,x:pts[hook].x+DR[0]*.08*R,y:pts[hook].y+DR[1]*.08*R,R,el:1.1,tip:1.15})}
  // とめ: press down-right and lift back up, leaving a rounded end.
  if(k==="stop"||k==="dot"){const R=wAt(n)*(k==="dot"?1:1.02),g=la[n];feet.push({i:n,x:pts[n].x-Math.cos(g)*.1*R+DR[0]*.2*R,y:pts[n].y-Math.sin(g)*.1*R+DR[1]*.2*R,R,el:1.12,tip:1.3})}
  // Dryness (かすれ) and timing along the stroke.
  const dry=[],T=[],V=CFG.speed;let tm=k==="dot"?60:110;
  for(let i=0;i<=n;i++){
    const t=i/n;let dr=0,v=V;
    if(k==="stop"||k==="hook"){v=V*(.55+.45*smooth(0,.12,t))*(1-.35*smooth(.85,1,t))}
    else if(k==="left"){dr=.9*smooth(.45,1,t);v=V*(.8+1.5*smooth(.3,1,t))}
    else if(k==="right"){dr=.4*smooth(.86,1,t);v=V*(t<.82?.75+.2*t:1.5)}
    else v=V*.45;
    if(hook>=0&&i>hook){dr=.1+.4*(i-hook)/(n-hook);v=V*1.8}
    for(const c of cs)if(Math.abs(c-i)*ds<1.5)v*=.6;
    dry.push(dr);
    if(i>0)tm+=ds/v;
    if(cs.includes(i))tm+=110;
    if(i===hook)tm+=120;
    T.push(tm);
  }
  const r2=rng(idx*977+13),NB=14;
  const br=Array.from({length:NB},(_,j)=>({o:(j+.5)/NB*2-1+(r2()-.5)*.08,th:r2(),nz:noise1(idx*53+j*7+1)}));
  return {k,n,ds,pts,segs,nx:la.map(g=>-Math.sin(g)),ny:la.map(g=>Math.cos(g)),wA,wB,feet,cut,dry,T,total:tm+(k==="stop"||k==="dot"?90:0),br};
}
// A brush footprint: an ellipse on the 45-degree brush axis, with the tip drawn out toward the upper left.
function foot(g,f,s){
  const a=f.R*f.el,b=f.R/f.el;g.beginPath();
  for(let j=0;j<=56;j++){
    const ph=j/56*TAU,rel=ph-Math.PI/4,re=a*b/Math.hypot(b*Math.cos(rel),a*Math.sin(rel));
    const r=re*(1+(f.tip-1)*Math.pow(Math.max(0,Math.cos(angDiff(ph,TIP))),8));
    g.lineTo((f.x+r*Math.cos(ph))*s,(f.y+r*Math.sin(ph))*s);
  }
  g.closePath();g.fill();
}
function cap(g,st,sg,i,s){
  const j=i-sg.a,p=st.pts[i],a=st.wA[i],b=st.wB[i],o=(a-b)/2;
  g.beginPath();g.arc((p.x+sg.nx[j]*o)*s,(p.y+sg.ny[j]*o)*s,Math.max(.01,(a+b)/2*s),0,TAU);g.fill();
}
// Draw a stroke up to sample k: outline, footprints, then bristle streaks cut out of the ink.
function renderStroke(g,st,k,s){
  g.fillStyle=INK;
  for(const sg of st.segs){
    if(sg.a>k)break;
    const b=Math.min(sg.b,k),clip=sg.a===0&&st.cut;
    if(b>sg.a){
      if(clip){
        const c=st.cut,mx=-Math.SQRT1_2*c.sg*1e3,my=Math.SQRT1_2*c.sg*1e3,ex=DR[0]*1e3,ey=DR[1]*1e3;
        g.save();g.beginPath();
        g.moveTo((c.x-ex)*s,(c.y-ey)*s);g.lineTo((c.x+ex)*s,(c.y+ey)*s);g.lineTo((c.x+ex+mx)*s,(c.y+ey+my)*s);g.lineTo((c.x-ex+mx)*s,(c.y-ey+my)*s);
        g.closePath();g.clip();
      }
      g.beginPath();
      for(let i=sg.a;i<=b;i++){const j=i-sg.a,p=st.pts[i];g.lineTo((p.x+sg.nx[j]*st.wA[i])*s,(p.y+sg.ny[j]*st.wA[i])*s)}
      for(let i=b;i>=sg.a;i--){const j=i-sg.a,p=st.pts[i];g.lineTo((p.x-sg.nx[j]*st.wB[i])*s,(p.y-sg.ny[j]*st.wB[i])*s)}
      g.closePath();g.fill();
      if(clip)g.restore();
    }
    if(sg.a>0||!st.cut)cap(g,st,sg,sg.a,s);
    if(!(clip&&b<3))cap(g,st,sg,b,s);
  }
  for(const f of st.feet)if(f.i<=k)foot(g,f,s);
  // Bristles: a faint streaky grain everywhere, and real gaps where the brush runs dry.
  g.save();g.globalCompositeOperation="destination-out";g.strokeStyle="#000";g.lineCap="round";
  const NB=st.br.length,CH=6;
  for(const z of st.br){
    for(const pass of [0,1]){
      g.globalAlpha=pass?.9:.07;
      for(let c0=0;c0<k;c0+=CH){
        const c1=Math.min(k,c0+CH),m=(c0+c1)>>1,wm=(st.wA[m]+st.wB[m])/2;
        g.beginPath();let on=false;
        for(let i=c0;i<=c1;i++){
          const p=st.pts[i],off=z.o>0?z.o*st.wA[i]:z.o*st.wB[i],s1=i*st.ds;
          const hit=pass
            ?st.dry[i]>.02&&st.dry[i]*(Math.abs(z.o)>.7?1.25:1)+.3*z.nz(s1*.7)-z.th*.85>.12
            :Math.abs(z.o)<.9&&z.nz(s1*.12+50)>.3;
          const x=(p.x+st.nx[i]*off)*s,y=(p.y+st.ny[i]*off)*s;
          if(hit){if(on)g.lineTo(x,y);else{g.moveTo(x,y);on=true}}else on=false;
        }
        g.lineWidth=Math.max(.4,wm*2/NB*(pass?.75:.4)*s);g.stroke();
      }
    }
  }
  g.restore();
}
const strokes=S.map(build);
const cv=document.getElementById("c"),ctx=cv.getContext("2d"),countEl=document.getElementById("count");
const done=document.createElement("canvas"),dctx=done.getContext("2d"),layer=document.createElement("canvas"),lctx=layer.getContext("2d");
let scale=1,dpr=1,raf=0;
function size(){const r=cv.getBoundingClientRect();dpr=Math.min(2,window.devicePixelRatio||1);cv.width=Math.round(r.width*dpr);cv.height=Math.round(r.height*dpr);for(const c of [done,layer]){c.width=cv.width;c.height=cv.height}scale=cv.width/109}
function paper(){
  dctx.clearRect(0,0,done.width,done.height);
  if(document.getElementById("grid").checked){
    dctx.save();dctx.strokeStyle="#e3cbbf";dctx.lineWidth=1*dpr;dctx.setLineDash([4*dpr,4*dpr]);
    dctx.beginPath();dctx.moveTo(done.width/2,0);dctx.lineTo(done.width/2,done.height);dctx.moveTo(0,done.height/2);dctx.lineTo(done.width,done.height/2);dctx.stroke();dctx.restore();
  }
}
// Ink is not quite opaque, so crossings darken a little, and its edge bleeds slightly into the paper.
function inkOnto(g){g.save();g.globalAlpha=.97;g.shadowColor=INK_EDGE;g.shadowBlur=1.1*dpr;g.drawImage(layer,0,0);g.restore()}
function paint(st,k){lctx.clearRect(0,0,layer.width,layer.height);renderStroke(lctx,st,k,scale)}
function show(){ctx.clearRect(0,0,cv.width,cv.height);ctx.drawImage(done,0,0)}
function count(txt){if(countEl)countEl.textContent=txt}
function draw(instant){
  cancelAnimationFrame(raf);size();paper();
  if(matchMedia("(prefers-reduced-motion: reduce)").matches||instant){
    for(const st of strokes){paint(st,st.n);inkOnto(dctx)}
    show();count(`${strokes.length} strokes`);return;
  }
  let si=0,t0=performance.now()+250;
  const step=now=>{
    const st=strokes[si],tau=now-t0;
    if(tau>=st.total){
      paint(st,st.n);inkOnto(dctx);show();si++;t0=now+CFG.gap;
      if(si>=strokes.length){count(`${strokes.length} strokes`);return}
    }else{
      show();
      if(tau>=0){let k=0;while(k<st.n&&st.T[k+1]<=tau)k++;paint(st,k);inkOnto(ctx)}
      count(`Stroke ${si+1} of ${strokes.length}`);
    }
    raf=requestAnimationFrame(step);
  };
  raf=requestAnimationFrame(step);
}
document.getElementById("replay").addEventListener("click",()=>draw(false));
document.getElementById("grid").addEventListener("change",()=>draw(true));
let rt;addEventListener("resize",()=>{clearTimeout(rt);rt=setTimeout(()=>draw(true),150)});
draw(false);
