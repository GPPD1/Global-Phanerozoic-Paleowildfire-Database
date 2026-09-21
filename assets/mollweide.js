import { pickScreenRecords, clusterScreenRecords } from './record-picking.js?v=20260920';

// Normalized Mollweide coordinates: x ∈ [-1,1], y ∈ [-1,1], north positive.
export function mollweideForward(lat, lon) {
  const phi = Math.max(-90, Math.min(90, lat)) * Math.PI / 180;
  let theta = phi;
  if (Math.abs(lat) < 89.999999) {
    for (let i=0;i<32;i++) {
      const d=(2*theta+Math.sin(2*theta)-Math.PI*Math.sin(phi))/(2+2*Math.cos(2*theta));
      theta-=d;
      if (Math.abs(d)<1e-12) break;
    }
  }
  return {x:lon/180*Math.cos(theta),y:Math.sin(theta)};
}

export function mollweideInverse(x, y) {
  if (x*x+y*y>1+1e-10) return null;
  const theta=Math.asin(Math.max(-1,Math.min(1,y)));
  const lon=Math.abs(Math.cos(theta))<1e-10 ? 0 : 180*x/Math.cos(theta);
  return {lat:Math.asin(Math.max(-1,Math.min(1,(2*theta+Math.sin(2*theta))/Math.PI)))*180/Math.PI,lng:lon};
}

// Longitude is linear on each Mollweide scanline, so a row-wise reprojection
// uses the original colour raster without downloading a second map sequence.
export function reprojectMollweide(image) {
  const canvas=document.createElement('canvas');
  canvas.width=image.width; canvas.height=Math.round(image.width/2);
  const ctx=canvas.getContext('2d');
  ctx.imageSmoothingEnabled=true;
  const w=canvas.width,h=canvas.height;
  for(let y=0;y<h;y++) {
    const t=Math.asin(1-2*(y+.5)/h);
    const lat=Math.asin((2*t+Math.sin(2*t))/Math.PI);
    const sy=Math.max(0,Math.min(image.height-1,(.5-lat/Math.PI)*image.height-.5));
    const span=w*Math.cos(t);
    ctx.drawImage(image,0,sy,image.width,1,(w-span)/2,y,span,1);
  }
  return canvas;
}

export class MollweideMap {
  constructor(canvas,onSelect) {
    this.canvas=canvas; this.ctx=canvas.getContext('2d'); this.onSelect=onSelect;
    this.zoom=1; this.pan={x:0,y:0}; this.data={points:[],plates:[]};
    this.screenPoints=[];
    this.markerLayer=document.createElement('div');
    this.markerLayer.className='map-record-markers';
    this.markerLayer.setAttribute('aria-label','Wildfire records on Mollweide map');
    canvas.after(this.markerLayer);
    const surface=canvas.parentElement;
    new ResizeObserver(()=>this.draw()).observe(canvas);
    let drag=null;
    surface.addEventListener('pointerdown',e=>{
      if(e.button!==0 || !(e.target===canvas || e.target.closest('.map-record-marker'))) return;
      drag={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false,
        records:e.target.closest('.map-record-marker')?.recordGroup};
      surface.setPointerCapture(e.pointerId);
    });
    surface.addEventListener('pointermove',e=>{
      if(!drag) {
        const r=canvas.getBoundingClientRect();
        canvas.style.cursor=pickScreenRecords(this.screenPoints,e.clientX-r.left,e.clientY-r.top).length?'pointer':'grab';
        return;
      }
      // A small hand/touch movement is still a click; do not move the map below
      // the drag threshold or make the marker move away from the pointer.
      if(!drag.moved && Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<7)return;
      const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
      this.pan.x+=dx;this.pan.y+=dy;
      drag.moved=true;
      drag.x=e.clientX;drag.y=e.clientY;this.draw();
    });
    surface.addEventListener('pointerup',e=>{
      if(drag&&!drag.moved) {
        if(drag.records)this.onSelect({records:drag.records,event:e});
        else this.select(e);
      }
      drag=null;
    });
    surface.addEventListener('pointercancel',()=>{drag=null;});
    surface.addEventListener('lostpointercapture',()=>{drag=null;});
    this.markerLayer.addEventListener('click',e=>{
      const button=e.target.closest('.map-record-marker');
      if(button && e.detail===0)this.onSelect({records:button.recordGroup,event:e});
    });
    surface.addEventListener('wheel',e=>{
      e.preventDefault(); const r=canvas.getBoundingClientRect();
      this.scale(Math.exp(-e.deltaY*.0015),e.clientX-r.left,e.clientY-r.top);
    },{passive:false});
    canvas.addEventListener('keydown',e=>{
      if(e.key==='+'||e.key==='=') { e.preventDefault();this.scale(1.3); }
      if(e.key==='-') { e.preventDefault();this.scale(1/1.3); }
      if(e.key==='Home') {e.preventDefault();this.reset();}
    });
  }
  setData(data) {
    this.data=data;
    if(data.image!==this.source) {
      this.source=data.image;
      this.raster=data.image ? reprojectMollweide(data.image) : null;
    }
    this.draw();
  }
  reset() {this.zoom=1;this.pan={x:0,y:0};this.draw();}
  focus(lat,lng) {
    this.reset();
    const p=mollweideForward(lat,lng);
    this.pan={x:-p.x*this.rx,y:p.y*this.ry};this.draw();
  }
  scale(factor,x,y) {
    const next=Math.max(1,Math.min(8,this.zoom*factor));
    const r=next/this.zoom;
    if(x!==undefined) {
      this.pan.x+=(x-this.cx)*(1-r);this.pan.y+=(y-this.cy)*(1-r);
    } else {this.pan.x*=r;this.pan.y*=r;}
    this.zoom=next;this.draw();
  }
  project(lat,lng) {
    const p=mollweideForward(lat,lng);
    return {x:this.cx+p.x*this.rx,y:this.cy-p.y*this.ry};
  }
  select(e) {
    const r=this.canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
    const records=pickScreenRecords(this.screenPoints,x,y).map(p=>p.record);
    const location=mollweideInverse((x-this.cx)/this.rx,(this.cy-y)/this.ry);
    let plateId=null,best=6;
    if (!records.length && location && this.data.showPlates) for(const plate of this.data.plates) {
      for(const [lat,lng,lat2,lng2] of plate.segments) {
        if(Math.abs(lng-lng2)>180)continue;
        const a=this.project(lat,lng),b=this.project(lat2,lng2);
        const dx=b.x-a.x,dy=b.y-a.y;
        const t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1)));
        const d=Math.hypot(x-a.x-t*dx,y-a.y-t*dy);
        if(d<best){best=d;plateId=plate.id;}
      }
    }
    this.onSelect({records,plateId,location,event:e});
  }
  draw() {
    const canvas=this.canvas,w=canvas.parentElement.clientWidth,h=canvas.parentElement.clientHeight;
    if(!w||!h)return;
    const dpr=Math.min(window.devicePixelRatio||1,2);
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)) {
      canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
    }
    const ctx=this.ctx;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    const top=w<600?135:145,bottom=w<600?195:180;
    const diameter=Math.min(w-36,Math.max(120,h-top-bottom)*2);
    this.rx=diameter/2*this.zoom;this.ry=this.rx/2;
    this.cx=w/2+this.pan.x;this.cy=(top+h-bottom)/2+this.pan.y;
    ctx.save();ctx.beginPath();ctx.ellipse(this.cx,this.cy,this.rx,this.ry,0,0,Math.PI*2);ctx.clip();
    ctx.fillStyle='#13354b';ctx.fillRect(0,0,w,h);
    if(this.raster)ctx.drawImage(this.raster,this.cx-this.rx,this.cy-this.ry,2*this.rx,2*this.ry);
    const segment=(lat,lng,lat2,lng2)=>{
      if(Math.abs(lng-lng2)>180)return; // Split at the map edge, never across the map.
      const a=this.project(lat,lng),b=this.project(lat2,lng2);
      ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
    };
    if(this.data.grid) {
      ctx.beginPath();ctx.strokeStyle='#cadde955';ctx.lineWidth=.65;
      for(let lat=-60;lat<=60;lat+=30)for(let lon=-180;lon<180;lon+=2)segment(lat,lon,lat,lon+2);
      for(let lon=-180;lon<=180;lon+=30)for(let lat=-90;lat<90;lat+=2)segment(lat,lon,lat+2,lon);
      ctx.stroke();
    }
    if(this.data.showPlates)for(const plate of this.data.plates) {
      const selected=this.data.selected===plate.id;
      ctx.beginPath();ctx.strokeStyle=this.data.selected==null?'#ffffff8c':selected?'#ffffff':'#ffffff30';
      ctx.lineWidth=selected?1.65:.85;
      for(const s of plate.segments)segment(...s);
      ctx.stroke();
    }
    this.screenPoints=[];
    if(this.data.showPoints)for(const point of this.data.points) {
      const p=this.project(point.location.lat,point.location.lng);
      if(p.x>=0 && p.y>=0 && p.x<=w && p.y<=h)this.screenPoints.push({...p,record:point.record});
    }
    const groups=clusterScreenRecords(this.screenPoints),fragment=document.createDocumentFragment();
    for(const group of groups) {
      const button=document.createElement('button');button.type='button';
      button.className='map-record-marker';button.style.left=`${group.x}px`;button.style.top=`${group.y}px`;
      button.recordGroup=group.records;
      const ids=group.records.map(p=>p.id).sort((a,b)=>a-b);
      const label=ids.length===1?`View wildfire record #${ids[0]}`:`View ${ids.length} wildfire records`;
      button.setAttribute('aria-label',label);button.title=`${label}: ${ids.map(id=>'#'+id).join(', ')}`;
      button.dataset.recordIds=ids.join(',');
      const dot=document.createElement('span');dot.className='map-record-dot';
      if(ids.length>1){dot.textContent=ids.length;button.classList.add('is-cluster');}
      button.append(dot);fragment.append(button);
    }
    this.markerLayer.replaceChildren(fragment);
    ctx.restore();ctx.beginPath();ctx.ellipse(this.cx,this.cy,this.rx,this.ry,0,0,Math.PI*2);
    ctx.strokeStyle='#b9d2df60';ctx.lineWidth=1;ctx.stroke();
    canvas.dataset.visiblePoints=this.screenPoints.length;
    canvas.dataset.zoom=this.zoom.toFixed(2);
  }
}
