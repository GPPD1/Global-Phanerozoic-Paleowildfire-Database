
import * as THREE from 'three';
import { sampleElevation, geographicUnit, makePlateFootprint, footprintContains } from './geography.js';
import { makeElevationTexture, configureTerrainMaterial } from './terrain-material.js?v=20260920';
import { MollweideMap } from './mollweide.js?v=20260921-clean';
import { pickScreenRecords } from './record-picking.js?v=20260920';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ============ Global state ============
let reconCurrentTime = 300; // Ma
let reconRotations = {};   // plate_id -> [[time, lat, lon, angle, ref_plate_id], ...]
let reconPlatePolygons = []; // [{id, name, vertices: [[lat,lng],...]}, ...]
let reconPointsData = [];    // [{id, plateId, lat, lng, timeBegin, timeEnd}, ...]
let reconRasters = [];       // [{time, file, boundingBox}, ...]
let reconShowPlates = false;
let reconShowPoints = true;
let reconShowRaster = true;
let reconCurrentRasterMesh = null;
let reconPlateLineMeshes = [];     // Line objects (rebuilt each time)
let reconPointMeshGroup = null;    // single Group containing all point sprites

// ============ Recon Scene init ============
let reconScene, reconCamera, reconRenderer, reconControls, reconEarth;
let reconAnimFrameId = null;
let reconInitialized = false;

// Playback state
let reconPlaying = false;
let reconPlayInterval = null;
let reconPlaySpeed = 1;

// ============ Coordinate helpers ============
function reconLatLngToVec3(lat, lng, radius) {
  const phi = (90 - lat) * Math.PI / 180;
  const theta = (lng + 180) * Math.PI / 180;
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

function reconNormalizeLon(lon) {
  const v = ((lon + 180) % 360 + 360) % 360 - 180;
  return v === -180 ? 180 : v;
}

function reconInterpLon(lon0, lon1, f) {
  let d = lon1 - lon0;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return reconNormalizeLon(lon0 + d * f);
}

// ============ Plate rotation calculation ============
const reconRotationCache = new Map();

function reconGetRotationForPlate(plateId, time) {
  const cacheKey = `${plateId}_${time}`;
  if (reconRotationCache.has(cacheKey)) return reconRotationCache.get(cacheKey);

  const plateRots = reconRotations[plateId];
  if (!plateRots || plateRots.length === 0) {
    const identity = { lat: 90, lon: 0, angle: 0, refPlateId: 0 };
    reconRotationCache.set(cacheKey, identity);
    return identity;
  }

  let older = plateRots[0];
  let younger = plateRots[plateRots.length - 1];
  if (time >= plateRots[0][0]) {
    older = younger = plateRots[0];
  } else if (time <= plateRots[plateRots.length - 1][0]) {
    older = younger = plateRots[plateRots.length - 1];
  } else {
    for (let i = 0; i < plateRots.length - 1; i++) {
      const a = plateRots[i];
      const b = plateRots[i + 1];
      if (a[0] >= time && time >= b[0]) {
        older = a;
        younger = b;
        break;
      }
    }
  }

  let lat, lon, angle, refPlateId;
  if (older === younger || older[0] === younger[0]) {
    [, lat, lon, angle, refPlateId] = older;
  } else {
    const [tOld, latOld, lonOld, angOld, refOld] = older;
    const [tYoung, latYoung, lonYoung, angYoung] = younger;
    const f = (tOld - tYoung) > 0 ? (time - tYoung) / (tOld - tYoung) : 0;
    lat = latYoung + (latOld - latYoung) * f;
    lon = reconInterpLon(lonYoung, lonOld, f);
    angle = angYoung + (angOld - angYoung) * f;
    refPlateId = refOld;
  }

  const result = { lat, lon, angle, refPlateId: Number(refPlateId) || 0 };
  reconRotationCache.set(cacheKey, result);
  return result;
}

function reconEulerToMatrix(lat, lon, angleDeg) {
  const angle = angleDeg * Math.PI / 180;
  const phi = lat * Math.PI / 180;
  const lambda = lon * Math.PI / 180;
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  const ex = Math.cos(phi) * Math.cos(lambda);
  const ey = Math.cos(phi) * Math.sin(lambda);
  const ez = Math.sin(phi);
  return [
    [cosA + ex*ex*(1-cosA),     ex*ey*(1-cosA) - ez*sinA, ex*ez*(1-cosA) + ey*sinA],
    [ey*ex*(1-cosA) + ez*sinA,  cosA + ey*ey*(1-cosA),    ey*ez*(1-cosA) - ex*sinA],
    [ez*ex*(1-cosA) - ey*sinA,  ez*ey*(1-cosA) + ex*sinA, cosA + ez*ez*(1-cosA)]
  ];
}

function reconApplyMatrix(m, v) {
  return [
    m[0][0]*v[0] + m[0][1]*v[1] + m[0][2]*v[2],
    m[1][0]*v[0] + m[1][1]*v[1] + m[1][2]*v[2],
    m[2][0]*v[0] + m[2][1]*v[1] + m[2][2]*v[2]
  ];
}

function reconLatLonToCartesianGeo(lat, lon) {
  const phi = lat * Math.PI / 180;
  const lambda = lon * Math.PI / 180;
  return [Math.cos(phi)*Math.cos(lambda), Math.cos(phi)*Math.sin(lambda), Math.sin(phi)];
}

function reconCartesianToLatLon(x, y, z) {
  const r = Math.sqrt(x*x + y*y + z*z) || 1;
  return { lat: Math.asin(Math.max(-1, Math.min(1, z/r))) * 180 / Math.PI,
           lng: reconNormalizeLon(Math.atan2(y, x) * 180 / Math.PI) };
}

function reconGetPlateRotationMatrix(plateId, time) {
  const rot = reconGetRotationForPlate(plateId, time);
  if (!rot || Math.abs(rot.angle) < 1e-6) return [[1,0,0],[0,1,0],[0,0,1]];
  return reconEulerToMatrix(rot.lat, rot.lon, rot.angle);
}

function reconReconstructPoint(plateId, lat, lng, time) {
  const matrix = reconGetPlateRotationMatrix(plateId, time);
  const v = reconApplyMatrix(matrix, reconLatLonToCartesianGeo(lat, lng));
  return reconCartesianToLatLon(v[0], v[1], v[2]);
}

// ============ Rebuild plate boundaries ============
function reconPolygonIsActive(activity, time) {
  if (!activity) return true;
  const from = Number(activity.validFrom), to = Number(activity.validTo);
  if (from === 0 && to === 0) return time < 0.001;
  return time <= from + 0.001 && (to < 0 || time >= to - 0.001);
}

function reconBuildPlateOutlines(time) {
  if (reconPlateOutlineAge === time) return;
  reconPlateOutlineAge = time;
  reconPlateOutlines = [];
  const seen = new Set();
  reconPlatePolygons.forEach((plate, index) => {
    if (!reconPolygonIsActive(reconPolygonActivity[index], time)) return;
    const segments = [];
    for (const ring of plate.rings || [plate.vertices]) {
      const directions = ring.map(([lat,lng]) => {
        const p = reconReconstructPoint(plate.id, lat, lng, time);
        return reconLatLngToVec3(p.lat, p.lng, 1);
      });
      for (let i=0; i<directions.length; i++) {
        const a=directions[i], b=directions[(i+1)%directions.length];
        const angle=a.angleTo(b);
        if (angle < 1e-7) continue;
        const keyA=a.toArray().map(v=>v.toFixed(6)).join(',');
        const keyB=b.toArray().map(v=>v.toFixed(6)).join(',');
        const key=plate.id+':'+[keyA,keyB].sort().join('/');
        if (seen.has(key)) continue;
        seen.add(key);
        const steps=Math.max(1,Math.ceil(angle/(Math.PI/720)));
        for(let j=0;j<steps;j++) {
          const u=reconDirectionLocation(a.clone().lerp(b,j/steps).normalize());
          const v=reconDirectionLocation(a.clone().lerp(b,(j+1)/steps).normalize());
          segments.push([u.lat,u.lng,v.lat,v.lng]);
        }
      }
    }
    if (segments.length) reconPlateOutlines.push({id:plate.id, segments});
  });
}

function reconRebuildPlates(time) {
  reconBuildPlateOutlines(time);
  reconPlateLineMeshes.forEach(line => { reconEarth.remove(line); line.geometry.dispose(); line.material.dispose(); });
  reconPlateLineMeshes = [];
  if (reconShowPlates) for (const plate of reconPlateOutlines) {
    const positions=[];
    for (const [lat,lng,lat2,lng2] of plate.segments) {
      positions.push(reconLatLngToVec3(lat,lng,reconSurfaceRadius(lat,lng,.002)),
        reconLatLngToVec3(lat2,lng2,reconSurfaceRadius(lat2,lng2,.002)));
    }
    const material=new THREE.LineBasicMaterial({color:0xffffff,transparent:true,
      opacity:reconSelectedPlate===null ? .45 : reconSelectedPlate===plate.id ? 1 : .15,
      depthTest:true,depthWrite:false});
    const line=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(positions),material);
    line.userData.plateId=plate.id;
    reconEarth.add(line); reconPlateLineMeshes.push(line);
  }
  reconRefreshFlatMap();
}

// ============ Fire point sprites ============
let reconPointTexture = null;
function reconCreatePointSprite(pointData) {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 12);
  gradient.addColorStop(0, 'rgba(255, 120, 80, 1)');
  gradient.addColorStop(0.3, 'rgba(255, 60, 40, 0.9)');
  gradient.addColorStop(0.7, 'rgba(255, 20, 10, 0.3)');
  gradient.addColorStop(1, 'rgba(255, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(16, 16, 12, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.beginPath();
  ctx.arc(16, 16, 3, 0, Math.PI * 2);
  ctx.fill();

  const texture = reconPointTexture || (reconPointTexture = new THREE.CanvasTexture(canvas));
  const spriteMat = new THREE.SpriteMaterial({
    map: texture,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    transparent: true,
    opacity: 0.85
  });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(0.009, 0.009, 0.009);
  sprite.userData = pointData;
  return sprite;
}

function reconCreateAllPointMarkers(points) {
  const group = new THREE.Group();
  group.userData = { points };

  points.forEach(point => {
    const sprite = reconCreatePointSprite(point);
    sprite.position.set(0, 0, 0);
    sprite.userData = point;
    group.add(sprite);
  });

  return group;
}

function reconUpdateAllPointPositions(time) {
  if (!reconPointMeshGroup) return;

  const sprites = reconPointMeshGroup.children;
  let visibleCount = 0;
  sprites.forEach(sprite => {
    const point = sprite.userData;

    const inTimeRange = time >= point.timeEnd && time <= point.timeBegin;
    sprite.visible = inTimeRange && reconShowPoints;
    if (sprite.visible) visibleCount++;

    if (!inTimeRange) return;

    const paleoPos = reconReconstructPoint(point.plateId, point.lat, point.lng, time);
    const pos = reconLatLngToVec3(paleoPos.lat, paleoPos.lng, reconSurfaceRadius(paleoPos.lat,paleoPos.lng,.008));
    sprite.position.copy(pos);
  });
  document.getElementById('recon-visible-count').textContent = visibleCount;

}

// Terrain and atlas surfaces use the same equirectangular coordinates as the points.
let reconDemFrames = [];
let reconBaseMode = 'terrain';
let reconRelief = true;
let reconGridGroup = null;
let reconSurfaceToken = 0;
let reconSurfaceKey = '';
let reconPendingSurface = null;
let reconPendingKey = '';
const reconTextureCache = new Map();
const reconTerrainLoader = new THREE.TextureLoader();
// Actual metre-valued elevation is used for both geometry and overlay placement.
let reconElevationGrid = null;
let reconElevationShape = {width:3601, height:1801};
let reconExaggeration = 18;
let reconSeafloor = true;
let reconTerrainNormals = null;
let reconTerrainHeights = null;
let reconLocalView = false;
let reconFocusLocation = {lat:-8, lng:-15};
let reconSelectedPlate = null;
let reconPlateFootprints = [];
let reconPolygonActivity = [];
let reconFlatMap = null;
let reconPlateOutlines = [];
let reconPlateOutlineAge = null;
let reconProjectionMode = 'globe';

async function reconLoadElevation(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Elevation request failed: ${response.status}`);
  const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  const {width, height} = reconElevationShape;
  if (buffer.byteLength !== width*height*2) throw new Error('Invalid elevation grid length');
  const values = new Int16Array(buffer);
  return {width, height, values};
}

function reconSurfaceRadius(lat, lng, clearance=0) {
  if (!reconElevationGrid || !reconRelief || !reconSurfaceKey.startsWith('terrain:')) return 1+clearance;
  const elevation = sampleElevation(reconElevationGrid, lat, lng);
  return 1+(reconSeafloor ? elevation : Math.max(0,elevation))*reconExaggeration/6371000+clearance;
}

function reconBuildTerrainGeometry() {
  const segments = window.matchMedia('(max-width: 800px)').matches ? 1024 : 2048;
  const geometry = new THREE.SphereGeometry(1, segments, segments/2);
  reconTerrainNormals = geometry.attributes.position.array.slice();
  return geometry;
}

function reconResampleSurface() {
  const geometry = reconCurrentRasterMesh.geometry;
  const uv = geometry.attributes.uv;
  reconTerrainHeights = new Float32Array(uv.count);
  if (!reconElevationGrid) return;
  for (let i=0; i<uv.count; i++) {
    reconTerrainHeights[i] = sampleElevation(reconElevationGrid, uv.getY(i)*180-90, uv.getX(i)*360-180);
  }
}

function reconApplyRelief() {
  if (!reconCurrentRasterMesh) return;
  const geometry = reconCurrentRasterMesh.geometry, positions = geometry.attributes.position;
  const enabled = reconRelief && reconSurfaceKey.startsWith('terrain:') && reconElevationGrid;
  const shading = reconCurrentRasterMesh.material.userData.terrainUniforms;
  shading.terrainShading.value = Boolean(enabled);
  shading.terrainScale.value = reconExaggeration;
  shading.seafloorShading.value = reconSeafloor;
  let minRadius = 1, maxRadius = 1;
  for (let i=0; i<positions.count; i++) {
    const elevation = reconTerrainHeights?.[i] || 0;
    const radius = enabled ? 1+(reconSeafloor ? elevation : Math.max(0,elevation))*reconExaggeration/6371000 : 1;
    minRadius = Math.min(minRadius,radius); maxRadius = Math.max(maxRadius,radius);
    const offset = i*3;
    positions.setXYZ(i,reconTerrainNormals[offset]*radius,reconTerrainNormals[offset+1]*radius,reconTerrainNormals[offset+2]*radius);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  // SphereGeometry duplicates vertices along the meridian seam and at the poles.
  const n = geometry.attributes.normal, width = geometry.parameters.widthSegments, height = geometry.parameters.heightSegments;
  for (let y=1; y<height; y++) {
    const first = y*(width+1), last = first+width;
    const normal = new THREE.Vector3(n.getX(first)+n.getX(last),n.getY(first)+n.getY(last),n.getZ(first)+n.getZ(last)).normalize();
    n.setXYZ(first,normal.x,normal.y,normal.z); n.setXYZ(last,normal.x,normal.y,normal.z);
  }
  for (let x=0; x<=width; x++) { n.setXYZ(x,0,1,0); n.setXYZ(height*(width+1)+x,0,-1,0); }
  n.needsUpdate = true;
  geometry.computeBoundingSphere();
  reconCurrentRasterMesh.userData.maxRadius = maxRadius;
  reconUpdateAllPointPositions(reconCurrentTime);
  reconRebuildPlates(reconCurrentTime);
  if (reconGridGroup) {
    reconGridGroup.children.forEach(line => {
      const p = line.geometry.attributes.position, base = line.userData.surfaceDirections;
      for (let i=0; i<p.count; i++) {
        const lat = Math.asin(Math.max(-1,Math.min(1,base[i*3+1])))*180/Math.PI;
        const lng = Math.atan2(-base[i*3+2],base[i*3])*180/Math.PI;
        const radius = reconSurfaceRadius(lat,lng,.003);
        p.setXYZ(i,base[i*3]*radius,base[i*3+1]*radius,base[i*3+2]*radius);
      }
      p.needsUpdate = true; line.geometry.computeBoundingSphere();
    });
  }
  const stage = document.getElementById('recon-globe-container');
  stage.dataset.minRadius = minRadius.toFixed(6); stage.dataset.maxRadius = maxRadius.toFixed(6);
  stage.dataset.verticalExaggeration = enabled ? reconExaggeration : 0;
  stage.dataset.terrainVertices = positions.count;
  document.getElementById('recon-relief-scale').textContent = enabled ? `Vertical scale · ${reconExaggeration}×` : 'Spherical surface';
  reconSyncLayerControls();
  if (reconLocalView) {
    const nextTarget = reconLatLngToVec3(reconFocusLocation.lat,reconFocusLocation.lng,reconSurfaceRadius(reconFocusLocation.lat,reconFocusLocation.lng));
    reconCamera.position.add(nextTarget.clone().sub(reconControls.target));
    reconControls.target.copy(nextTarget);
    reconControls.update();
  }
}

function reconDirectionLocation(direction) {
  const unit = direction.clone().normalize();
  return {lat:Math.asin(Math.max(-1,Math.min(1,unit.y)))*180/Math.PI, lng:Math.atan2(-unit.z,unit.x)*180/Math.PI};
}

function reconSetTerrainView(local, location) {
  reconLocalView = local;
  if (location) reconFocusLocation = location;
  else if (local) reconFocusLocation = reconDirectionLocation(reconCamera.position);
  const {lat,lng} = reconFocusLocation;
  const normal = reconLatLngToVec3(lat,lng,1);
  reconControls.autoRotate = false;
  if (local) {
    const target = normal.clone().multiplyScalar(reconSurfaceRadius(lat,lng));
    const north = new THREE.Vector3(0,1,0).addScaledVector(normal,-normal.y).normalize();
    if (north.lengthSq()<.01) north.set(1,0,0);
    reconCamera.up.copy(normal);
    reconControls.dispose(); reconControls = new OrbitControls(reconCamera,reconRenderer.domElement);
    reconControls.enableDamping=true; reconControls.dampingFactor=.08; reconControls.enablePan=false;
    reconControls.target.copy(target);
    reconCamera.position.copy(target).addScaledVector(normal,.14).addScaledVector(north,-.24);
    reconControls.minDistance = .16; reconControls.maxDistance = 2.0;
    reconControls.maxPolarAngle = Math.PI*.39;
  } else {
    reconCamera.up.set(0,1,0);
    reconControls.dispose(); reconControls = new OrbitControls(reconCamera,reconRenderer.domElement);
    reconControls.enableDamping=true; reconControls.dampingFactor=.08; reconControls.enablePan=false;
    reconControls.target.set(0,0,0);
    const stage = document.getElementById('recon-globe-container');
    const diameter = Math.min(stage.clientWidth*.85,stage.clientHeight*.68);
    const distance = Math.sqrt(1+Math.pow(stage.clientHeight/(diameter*Math.tan(Math.PI/8)),2));
    reconCamera.position.copy(normal).multiplyScalar(distance);
    reconControls.minDistance = 1.18; reconControls.maxDistance = 12; reconControls.maxPolarAngle = Math.PI;
  }
  reconControls.update();
  document.getElementById('recon-view-globe').setAttribute('aria-pressed', !local);
  document.getElementById('recon-view-terrain').setAttribute('aria-pressed', local);
  document.getElementById('recon-view-instruction').textContent = local ? 'Drag to tilt · Scroll to zoom · Double-click a new location' : 'Drag to rotate · Scroll to zoom · Double-click for terrain';
  document.getElementById('recon-globe-container').dataset.view = local ? 'terrain' : 'globe';
}

function reconHidePlatePopup() {
  document.getElementById('reconPlatePopup').hidden = true;
  reconSelectedPlate = null;
  reconPlateLineMeshes.forEach(line=>line.material.opacity=.45);
  reconRefreshFlatMap();
}

function reconShowPlateInfo(plateId) {
  reconSelectedPlate = Number(plateId);
  reconHidePopup();
  const panel = document.getElementById('reconPlatePopup');
  const rotation = reconGetRotationForPlate(plateId,reconCurrentTime);
  const fragments = reconPlatePolygons.filter((p,i)=>p.id===Number(plateId) && reconPolygonIsActive(reconPolygonActivity[i],reconCurrentTime));
  const records = reconPointsData.filter(p=>p.plateId===Number(plateId));
  const active = records.filter(p=>reconCurrentTime>=p.timeEnd&&reconCurrentTime<=p.timeBegin).length;
  const values = [
    ['Plate ID',plateId],['Source label',fragments[0]?.name || `Plate_${plateId}`],
    ['Age',`${reconCurrentTime} Ma`],['Model fragments',fragments.length],
    ['Wildfire records',`${active} at this age / ${records.length} total`],
    ['Euler pole',`${rotation.lat.toFixed(2)}°, ${rotation.lon.toFixed(2)}°`],
    ['Rotation',`${rotation.angle.toFixed(2)}°`],['Reference plate',rotation.refPlateId]
  ];
  panel.replaceChildren();
  const close=document.createElement('button'); close.className='popup-close'; close.setAttribute('aria-label','Close plate information'); close.textContent='×'; close.onclick=reconHidePlatePopup; panel.append(close);
  const heading=document.createElement('h3'); heading.textContent=`Plate ${plateId}`; panel.append(heading);
  values.forEach(([label,value])=>{
    const row=document.createElement('div');row.className='row';
    const name=document.createElement('span');name.className='label';name.textContent=label;
    const content=document.createElement('span');content.className='value';content.textContent=value;
    row.append(name,content);panel.append(row);
  });
  const note=document.createElement('p');note.className='plate-source';note.textContent='PALEOMAP reconstruction fragments. Outlines can overlap; they do not classify spreading or subduction boundaries.';panel.append(note);
  panel.hidden=false;
  reconPlateLineMeshes.forEach(line=>line.material.opacity=line.userData.plateId===Number(plateId)?1:.15);
  reconRefreshFlatMap();
}

function reconTogglePlateInfo(visible) {
  reconShowPlates=visible;
  document.getElementById('recon-plate-toggle').setAttribute('aria-pressed',visible);
  document.getElementById('recon-plate-hint').hidden=!visible;
  if(!visible) reconHidePlatePopup();
  else document.getElementById('recon-plate-hint').textContent='Click a white outline or a plate interior';
  reconRebuildPlates(reconCurrentTime);
}

function reconPickPlate(surfacePoint) {
  const location=reconDirectionLocation(surfacePoint);
  const geographic=geographicUnit(location.lat,location.lng);
  const inversePoints=new Map();
  for(let i=0;i<reconPlatePolygons.length;i++){
    if(!reconPolygonIsActive(reconPolygonActivity[i],reconCurrentTime)) continue;
    const plate=reconPlatePolygons[i];
    if(!inversePoints.has(plate.id)){
      const m=reconGetPlateRotationMatrix(plate.id,reconCurrentTime);
      inversePoints.set(plate.id,[0,1,2].map(j=>m[0][j]*geographic[0]+m[1][j]*geographic[1]+m[2][j]*geographic[2]));
    }
    if(reconPlateFootprints[i].some(footprint=>footprintContains(footprint,inversePoints.get(plate.id)))) return plate.id;
  }
  return null;
}

function reconGetSurfaceHit(event) {
  const rect=reconRenderer.domElement.getBoundingClientRect();
  reconMouse.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
  reconRaycaster.setFromCamera(reconMouse,reconCamera);
  return reconCurrentRasterMesh ? reconRaycaster.intersectObject(reconCurrentRasterMesh,false)[0] : null;
}

function reconBindTerrainControls() {
  document.getElementById('recon-exaggeration').addEventListener('input',event=>{
    reconExaggeration=Number(event.target.value);
    document.getElementById('recon-exaggeration-value').textContent=`${reconExaggeration}×`;
    reconApplyRelief();
  });
  document.getElementById('recon-seafloor').addEventListener('change',event=>{reconSeafloor=event.target.checked;reconApplyRelief();});
  document.getElementById('recon-view-globe').addEventListener('click',()=>reconSetTerrainView(false));
  document.getElementById('recon-view-terrain').addEventListener('click',()=>reconSetTerrainView(true));
  document.getElementById('recon-plate-toggle').addEventListener('click',()=>reconTogglePlateInfo(!reconShowPlates));
}


function reconNearestFrame(frames, time) {
  return frames.reduce((best, frame) => !best || Math.abs(frame.time-time) < Math.abs(best.time-time) ? frame : best, null);
}

function reconLoadTexture(url, color) {
  return new Promise((resolve, reject) => {
    reconTerrainLoader.load(url, texture => {
      if (color) texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(16, reconRenderer.capabilities.getMaxAnisotropy());
      texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true;
      resolve(texture);
    }, undefined, reject);
  });
}

async function reconGetTextures(key, frame, mode) {
  if (reconTextureCache.has(key)) {
    const cached = reconTextureCache.get(key);
    reconTextureCache.delete(key); reconTextureCache.set(key, cached);
    return cached;
  }
  const url = mode === 'terrain' ? `${frame.color}?v=20260920-relief` : `plates/PALEOMAP PaleoAtlas Rasters v3/${frame.file}`;
  const [map, elevation] = await Promise.all([
    reconLoadTexture(url, true),
    mode === 'terrain' ? reconLoadElevation(frame.elevation) : null
  ]);
  const textures = {map, elevation, detail: elevation ? makeElevationTexture(elevation) : null};
  reconTextureCache.set(key, textures);
  // Only retain a small set of visited time slices in GPU memory.
  while (reconTextureCache.size > 4) {
    const oldest = Array.from(reconTextureCache.keys()).find(k => k !== reconSurfaceKey && k !== key);
    if (!oldest) break;
    const previous = reconTextureCache.get(oldest);
    previous.map.dispose(); previous.detail?.dispose(); reconTextureCache.delete(oldest);
  }
  return textures;
}

function reconRefreshFlatMap() {
  if (!reconFlatMap || reconProjectionMode !== 'mollweide') return;
  reconFlatMap.setData({
    image:reconCurrentRasterMesh?.material.map?.image,
    points:reconPointsData.filter(p=>reconCurrentTime>=p.timeEnd && reconCurrentTime<=p.timeBegin)
      .map(p=>({record:p,location:reconReconstructPoint(p.plateId,p.lat,p.lng,reconCurrentTime)})),
    plates:reconPlateOutlines, selected:reconSelectedPlate,
    showPoints:reconShowPoints,showPlates:reconShowPlates,
    grid:document.getElementById('recon-grid').checked
  });
}

function reconSyncLayerControls() {
  const flat = reconProjectionMode === 'mollweide';
  const terrain = reconBaseMode === 'terrain';
  document.getElementById('recon-relief').disabled = flat || !terrain;
  document.getElementById('recon-exaggeration').disabled = flat || !terrain || !reconRelief;
  document.getElementById('recon-seafloor').disabled = flat || !terrain || !reconRelief;
}

function reconUpdateProjection(time) {
  const stage = document.getElementById('recon-globe-container');
  const view = document.getElementById('recon-mollweide-view');
  if (!stage || !view) return;
  const mollweide = reconProjectionMode === 'mollweide';
  stage.classList.toggle('projection-mollweide', mollweide);
  view.hidden = !mollweide;
  stage.dataset.projection = mollweide ? 'Mollweide' : 'Globe';
  reconSyncLayerControls();
  if (!mollweide) return;
  const loaded = stage.dataset.terrainAge;
  document.getElementById('recon-mollweide-caption').textContent =
    `Mollweide · ${time} Ma · ${loaded ? 'surface '+loaded+' Ma' : 'loading surface'}`;
  reconRefreshFlatMap();
}




function reconUpdateRaster(time) {
  const mode = reconBaseMode;
  const frame = reconNearestFrame(mode === 'terrain' ? reconDemFrames : reconRasters, time);
  if (!frame) return Promise.resolve();
  const key = `${mode}:${frame.time}`;
  const status = document.getElementById('recon-terrain-status');
  const caption = `${mode === 'terrain' ? 'Terrain' : 'Atlas'} slice · ${frame.time} Ma`;
  if (key === reconSurfaceKey) {
    // A pending older request must not replace the map when the user returns here.
    if (reconPendingKey && reconPendingKey !== key) {
      ++reconSurfaceToken; reconPendingKey = ''; reconPendingSurface = null;
    }
    status.textContent = `${caption} · nearest available map`;
    document.getElementById('recon-globe-container').dataset.surface=mode;
    reconUpdateProjection(time);
    return Promise.resolve();
  }
  if (key === reconPendingKey) return reconPendingSurface;
  const token = ++reconSurfaceToken;
  reconPendingKey = key;
  status.textContent = `Loading ${caption.toLowerCase()}…`;
  reconPendingSurface = reconGetTextures(key, frame, mode).then(textures => {
    if (token !== reconSurfaceToken) return;
    if (!reconCurrentRasterMesh) {
      const geometry = reconBuildTerrainGeometry();
      const material = new THREE.MeshPhongMaterial({color:0xffffff, shininess:0, specular:0x000000});
      configureTerrainMaterial(material);
      reconCurrentRasterMesh = new THREE.Mesh(geometry, material);
      reconEarth.add(reconCurrentRasterMesh);
    }
    const material = reconCurrentRasterMesh.material;
    material.map = textures.map;
    material.userData.terrainUniforms.nativeDEM.value = textures.detail;
    if (textures.elevation) material.userData.terrainUniforms.demSize.value.set(textures.elevation.width, textures.elevation.height);
    reconElevationGrid = textures.elevation;
    material.needsUpdate = true;
    reconSurfaceKey = key;
    reconResampleSurface();
    reconApplyRelief();
    status.textContent = `${caption} · nearest available map`;
    document.getElementById('recon-legend').hidden = mode !== 'terrain';
    reconSyncLayerControls();
    // A DOM diagnostic also records which real, loaded slice is currently shown.
    document.getElementById('recon-globe-container').dataset.terrainAge = frame.time;
    document.getElementById('recon-globe-container').dataset.surface = mode;
    reconUpdateProjection(reconCurrentTime);
  }).catch(error => {
    if (token !== reconSurfaceToken) return;
    status.textContent = 'Surface could not load. Previous map retained; change age to retry.';
    console.warn('Surface load failed:', frame.time, error);
  }).finally(() => {
    if (token === reconSurfaceToken) { reconPendingKey = ''; reconPendingSurface = null; }
  });
  return reconPendingSurface;
}

function reconFilterDirectory() {
  const query = document.getElementById('recon-search').value.trim().toLowerCase();
  const idQuery = /^#?\d+$/.test(query) ? Number(query.replace('#','')) : null;
  let matches = 0;
  document.querySelectorAll('.recon-point-item').forEach(item => {
    const point = reconMergedLookup[item.dataset.pointId];
    const visible = !query || (idQuery !== null ? point.id === idQuery : `${point.evidence} ${point.reference} ${point.lithostratigraphicUnit || ''} ${point.epochKey} ${point.lat} ${point.lng}`.toLowerCase().includes(query));
    item.hidden = !visible;
    if (visible) matches++;
  });
  document.querySelectorAll('.recon-epoch-group').forEach(group => {
    group.hidden = !group.querySelector('.recon-point-item:not([hidden])');
    group.querySelector('.recon-epoch-point-items').classList.toggle('open', Boolean(query) && !group.hidden);
  });
  document.querySelectorAll('.recon-period-group').forEach(group => {
    group.hidden = !group.querySelector('.recon-epoch-group:not([hidden])');
    group.querySelector('.recon-epoch-points').classList.toggle('open', Boolean(query) && !group.hidden);
  });
  const empty = document.getElementById('recon-search-empty');
  if (empty) empty.hidden = matches > 0;
}

function reconBindLayerControls() {
  document.getElementById('recon-basemap').addEventListener('change', event => {
    reconBaseMode = event.target.value;
    reconUpdateRaster(reconCurrentTime);
  });
  document.getElementById('recon-projection').addEventListener('change', event => {
    reconProjectionMode = event.target.value;
    reconHidePopup();reconHidePlatePopup();
    if (reconProjectionMode === 'globe') reconSetTerrainView(false);
    reconUpdateProjection(reconCurrentTime);
  });
  document.getElementById('recon-relief').addEventListener('change', event => {
    reconRelief = event.target.checked;
    reconApplyRelief();
  });
  document.getElementById('recon-points').addEventListener('change', event => {
    reconShowPoints = event.target.checked; reconUpdateAllPointPositions(reconCurrentTime); reconHidePopup(); reconRefreshFlatMap();
  });
  document.getElementById('recon-grid').addEventListener('change', event => {
    if (reconGridGroup) reconGridGroup.visible = event.target.checked;
    reconRefreshFlatMap();
  });
  document.getElementById('recon-search').addEventListener('input', reconFilterDirectory);
  document.getElementById('recon-layers-toggle').addEventListener('click', event => {
    const opened = document.getElementById('recon-layer-panel').classList.toggle('layers-open');
    event.currentTarget.setAttribute('aria-expanded', opened);
    event.currentTarget.textContent = opened ? 'Layers −' : 'Layers +';
  });
  document.getElementById('recon-directory-toggle').addEventListener('click', event => {
    const opened = document.querySelector('.recon-layout-wrap').classList.toggle('directory-open');
    event.currentTarget.setAttribute('aria-expanded', opened);
    event.currentTarget.textContent = opened ? '× Close records' : '☰ Records';
  });
}


// ============ Geological era names ============
function reconGetEraName(timeMa) {
  if (timeMa < 2.58) return 'Quaternary';
  if (timeMa < 23.03) return 'Neogene';
  if (timeMa < 66) return 'Paleogene';
  if (timeMa < 145) return 'Cretaceous';
  if (timeMa < 201.3) return 'Jurassic';
  if (timeMa < 252.17) return 'Triassic';
  if (timeMa < 298.9) return 'Permian';
  if (timeMa < 358.9) return 'Carboniferous';
  if (timeMa < 419.2) return 'Devonian';
  if (timeMa < 443.8) return 'Silurian';
  if (timeMa < 485.4) return 'Ordovician';
  if (timeMa < 541) return 'Cambrian';
  return 'Precambrian';
}

// ============ Screen projection ============
function reconProjectPointToScreen(plateId, lat, lng, time) {
  const paleoPos = reconReconstructPoint(plateId, lat, lng, time);
  const pos3D = reconLatLngToVec3(paleoPos.lat, paleoPos.lng, reconSurfaceRadius(paleoPos.lat,paleoPos.lng,.008));
  const vector = pos3D.clone().project(reconCamera);
  const container = document.getElementById('recon-globe-container');
  if (!container) return { x: 0, y: 0 };
  const rect = container.getBoundingClientRect();
  return {
    x: (vector.x * 0.5 + 0.5) * rect.width + rect.left,
    y: (-vector.y * 0.5 + 0.5) * rect.height + rect.top
  };
}

// ============ Popup ============
const reconRaycaster = new THREE.Raycaster();
const reconMouse = new THREE.Vector2();

function reconGetIntersections(event) {
  const rect = reconRenderer.domElement.getBoundingClientRect();
  const projected=[];
  for (const sprite of reconPointMeshGroup?.children || []) {
    if(!sprite.visible)continue;
    const position=sprite.getWorldPosition(new THREE.Vector3());
    if(position.dot(reconCamera.position.clone().sub(position))<=0)continue;
    const p=position.project(reconCamera);
    if(p.z < -1 || p.z > 1)continue;
    projected.push({x:(p.x*.5+.5)*rect.width,y:(.5-p.y*.5)*rect.height,
      record:sprite.userData,object:sprite});
  }
  return pickScreenRecords(projected,event.clientX-rect.left,event.clientY-rect.top);
}

let reconFullPointLookup = {}; // id -> { evidence, reference, epochKey, epochInfo }

let reconPointsLookup = {}; // id -> { plateId, timeBegin, timeEnd, lat, lng }

let reconMergedLookup = {}; // id -> { id, plateId, lat, lng, timeBegin, timeEnd, evidence, reference, epochKey, epochInfo }

function reconBuildPointLookup() {
  reconFullPointLookup = {};
  reconPointsLookup = {};
  reconMergedLookup = {};

  // Step 1: index reconPointsData → reconPointsLookup (time/plate data)
  if (Array.isArray(reconPointsData)) {
    for (const pd of reconPointsData) {
      if (pd.id !== undefined && pd.id !== null) {
        const entry = {
          plateId: pd.plateId || 0,
          timeBegin: pd.timeBegin,
          timeEnd: pd.timeEnd,
          lat: pd.lat,
          lng: pd.lng
        };
        reconPointsLookup[pd.id] = entry;
        reconMergedLookup[pd.id] = {
          id: pd.id,
          plateId: entry.plateId,
          lat: entry.lat,
          lng: entry.lng,
          timeBegin: entry.timeBegin,
          timeEnd: entry.timeEnd,
          evidence: 'N/A',
          reference: '',
          lithostratigraphicUnit: null,
          epochKey: '',
          epochInfo: null
        };
      }
    }
  }

  // Step 2: enrich from globalJson (evidence/reference/epoch info)
  if (window.globalJson) {
    for (let [epochKey, fcont] of Object.entries(window.globalJson)) {
      if (!fcont.data) continue;
      const epochInfo = window.strataMapping[epochKey.toLowerCase()] || null;
      for (let pt of fcont.data) {
        const pid = pt.id;
        if (pid === undefined || pid === null) continue;
        const evidence = window.normalizeEvidenceFullName(pt['Wildfire evidence type']);
        const reference = pt['Reference'] || '';
        const lithostratigraphicUnit = pt.lithostratigraphicUnit ?? null;
        const epochKeyLower = epochKey.toLowerCase();

        // Store in full lookup (legacy)
        reconFullPointLookup[pid] = { evidence, reference, lithostratigraphicUnit, epochKey: epochKeyLower, epochInfo };

        // Merge into unified lookup
        if (reconMergedLookup[pid]) {
          reconMergedLookup[pid].evidence = evidence;
          reconMergedLookup[pid].reference = reference;
          reconMergedLookup[pid].lithostratigraphicUnit = lithostratigraphicUnit;
          reconMergedLookup[pid].epochKey = epochKeyLower;
          reconMergedLookup[pid].epochInfo = epochInfo;
        } else {
          // Point exists in globalJson but not in reconPointsData — create minimal entry
          reconMergedLookup[pid] = {
            id: pid,
            plateId: 0,
            lat: pt.lat,
            lng: pt.lng,
            timeBegin: null,
            timeEnd: null,
            evidence: evidence,
            reference: reference,
            lithostratigraphicUnit,
            epochKey: epochKeyLower,
            epochInfo: epochInfo
          };
        }
      }
    }
  }
}

function reconGetPointDetails(pointId) {
  // Prefer merged lookup (has everything)
  const merged = reconMergedLookup[pointId];
  if (merged) return merged;
  return reconFullPointLookup[pointId] || null;
}

function reconShowRecordSelection(records,eventX,eventY) {
  if(!records?.length)return;
  reconShowPopup(records[0],eventX,eventY);
  if(records.length===1)return;
  const popup=document.getElementById('reconPopup');
  const picker=document.createElement('label');picker.className='record-picker';
  picker.append(`${records.length} nearby records · choose a record`);
  const select=document.createElement('select');select.setAttribute('aria-label','Choose a nearby wildfire record');
  for(const record of records) {
    const option=document.createElement('option'),details=reconGetPointDetails(record.id);
    option.value=record.id;option.textContent=`#${record.id} · ${details?.evidence || 'Wildfire record'}`;
    select.append(option);
  }
  picker.append(select);popup.querySelector('h3').before(picker);
  select.addEventListener('change',()=>{
    const record=records.find(p=>p.id===Number(select.value));
    reconShowPopup(record,eventX,eventY);
    popup.querySelector('h3').before(picker);
  });
}

function reconShowPopup(data, eventX, eventY) {
  const popup = document.getElementById('reconPopup');
  if (!popup) return;
  const details = reconGetPointDetails(data.id);
  const evidence = details ? (details.evidence || 'N/A') : 'N/A';
  const reference = details ? (details.reference || '') : 'N/A';
  const plateId = details ? (details.plateId || data.plateId || 0) : (data.plateId || 0);
  const timeBegin = details && details.timeBegin != null ? details.timeBegin : (data.timeBegin || 0);
  const timeEnd = details && details.timeEnd != null ? details.timeEnd : (data.timeEnd || 0);
  const lat = details ? details.lat : data.lat;
  const lng = details ? details.lng : data.lng;

  // ========== 新增：生成与 Data 页面一致的地层名称 ==========
  let epochDisplay = '';
  if (details && details.epochInfo) {
    // 优先使用 epochInfo 中的名称和短代码
    const name = details.epochInfo.name_en;
    const short = details.epochInfo.short;
    epochDisplay = `${name} (${short})`;
  } else if (details && details.epochKey && window.strataMapping && window.strataMapping[details.epochKey]) {
    // 回退：通过 epochKey 查找
    const info = window.strataMapping[details.epochKey];
    epochDisplay = `${info.name_en} (${info.short})`;
  } else {
    // 最终回退：显示时间范围
    epochDisplay = `${timeEnd.toFixed(1)} – ${timeBegin.toFixed(1)} Ma`;
  }
  // ========================================================

  let html = `<button class="popup-close" aria-label="Close record details">×</button><h3>Fire Point #${data.id}</h3>`;
  // 使用 epochDisplay 替换原来的时间范围行
  html += `<div class="row"><span class="label">Period (Epoch):</span><span class="value">${epochDisplay}</span></div>`;
  html += '<div class="row"><span class="label">Lithostratigraphic unit:</span><span class="value" data-field="lithostratigraphic-unit"></span></div>';
  html += `<div class="row"><span class="label">Plate ID:</span><span class="value">${plateId}</span></div>`;
  html += `<div class="row"><span class="label">Coordinates:</span><span class="value">${lat.toFixed(4)}, ${lng.toFixed(4)}</span></div>`;

  if (reconCurrentTime >= timeEnd && reconCurrentTime <= timeBegin) {
    const paleoPos = reconReconstructPoint(plateId, lat, lng, reconCurrentTime);
    html += `<div class="row"><span class="label">Paleocoordinates:</span><span class="value">${paleoPos.lat.toFixed(4)}, ${paleoPos.lng.toFixed(4)}</span></div>`;
  } else {
    html += `<div class="row"><span class="label">Paleocoordinates:</span><span class="value">Not available</span></div>`;
  }

  html += `<div class="row"><span class="label">Proxy Type:</span><span class="value">${evidence}</span></div>`;
  html += `<div class="row"><span class="label">Reference:</span><span class="value" style="font-size:11px;">${reference || 'N/A'}</span></div>`;

  html += `<button class="inspect-point-plate" type="button">Inspect plate ${plateId} ↗</button>`;
  reconHidePlatePopup();
  popup.innerHTML = html;
  popup.querySelector('[data-field="lithostratigraphic-unit"]').textContent = details?.lithostratigraphicUnit || '—';
  popup.querySelector('.inspect-point-plate').addEventListener('click',()=>{reconTogglePlateInfo(true);reconShowPlateInfo(plateId);});
  popup.querySelector('.popup-close').addEventListener('click', reconHidePopup);
  popup.style.left = Math.min(eventX, window.innerWidth - 350) + 'px';
  popup.style.top = Math.max(eventY - 180, 10) + 'px';
  popup.classList.add('active');
}

function reconHidePopup() {
  const popup = document.getElementById('reconPopup');
  if (popup) popup.classList.remove('active');
}

// ============ Sidebar directory ============
function reconBuildSidebar() {
  const container = document.getElementById('recon-strata-list');
  if (!container) return;
  container.innerHTML = '';

  // Group points by period/epoch using globalJson
  const epochGroups = new Map(); // epochKey -> { points: [...], epochInfo }
  for (let [epochKey, fcont] of Object.entries(window.globalJson)) {
    if (!fcont.data) continue;
    const key = epochKey.toLowerCase();
    const info = window.strataMapping[key] || null;
    if (!epochGroups.has(key)) epochGroups.set(key, { points: [], epochInfo: info });
    epochGroups.get(key).points.push(...fcont.data);
  }

  // Group epochs by period
  const periodGroups = new Map(); // periodCode -> [{epochKey, epochName, short, points, color}]
  for (let [epochKey, group] of epochGroups.entries()) {
    const info = group.epochInfo;
    if (!info) continue;
    const periodCode = info.periodCode;
    if (!periodGroups.has(periodCode)) periodGroups.set(periodCode, []);
    periodGroups.get(periodCode).push({
      epochKey,
      epochName: info.name_en,
      short: info.short,
      baseAge: info.baseAge,
      points: group.points,
      color: window.EPOCH_COLOR_MAP[epochKey] || '#aaa'
    });
  }

  // Build DOM in period order
  for (let periodCode of window.PERIOD_ORDER) {
    const epochs = periodGroups.get(periodCode) || [];
    if (epochs.length === 0) continue;
    epochs.sort((a, b) => b.baseAge - a.baseAge);

    const pointTotal = epochs.reduce((s, e) => s + e.points.length, 0);
    const periodDiv = document.createElement('div');
    periodDiv.className = 'recon-period-group';

    const header = document.createElement('div');
    header.className = 'recon-period-header';
    header.innerHTML = `${window.PERIOD_DATA[periodCode].name} <span class="badge">${pointTotal} pts</span>`;
    header.addEventListener('click', () => {
      const epCont = periodDiv.querySelector('.recon-epoch-points');
      if (epCont) epCont.classList.toggle('open');
    });

    const epochPointsCont = document.createElement('div');
    epochPointsCont.className = 'recon-epoch-points';

    epochs.forEach(epoch => {
      // Epoch group wrapper
      const epochGroup = document.createElement('div');
      epochGroup.className = 'recon-epoch-group';

      // Epoch sub-header (clickable to expand/collapse points)
      const epochHeader = document.createElement('div');
      epochHeader.className = 'recon-epoch-group-header';
      epochHeader.innerHTML = `${epoch.epochName} (${epoch.short}) · ${epoch.points.length} pts <span class="toggle-icon"><i class="fas fa-chevron-right"></i></span>`;

      // Point items container (hidden by default)
      const pointItemsCont = document.createElement('div');
      pointItemsCont.className = 'recon-epoch-point-items';

      // Individual point items
      epoch.points.forEach(pt => {
        const item = document.createElement('div');
        item.className = 'recon-point-item';
        item.dataset.pointId = pt.id;
        item.innerHTML = `
          <span class="recon-point-dot" style="background:${epoch.color};"></span>
          <span class="recon-point-info">
            <span class="recon-point-id">#${pt.id}</span>
            <span class="recon-point-time">${pt.lat.toFixed(2)}°, ${pt.lng.toFixed(2)}°</span>
          </span>`;

        item.addEventListener('click', (e) => {
          e.stopPropagation();
          reconStopPlayback();
          document.querySelector('.recon-layout-wrap').classList.remove('directory-open');
          const menuButton = document.getElementById('recon-directory-toggle');
          menuButton.setAttribute('aria-expanded', 'false'); menuButton.textContent = '☰ Records';
          // Highlight active item
          document.querySelectorAll('.recon-point-item').forEach(el => el.classList.remove('active'));
          item.classList.add('active');

          // Get full merged data (combines reconPointsData + globalJson)
          const pdata = reconMergedLookup[pt.id];
          if (!pdata) return;

          // If time data exists, jump to that geological era
          if (pdata.timeBegin != null && pdata.timeEnd != null) {
            const eraTime = (pdata.timeBegin + pdata.timeEnd) / 2;
            reconSetTime(eraTime);
          }

          // Rotate camera to face the point on the globe
          setTimeout(() => {
            const paleoPos = reconReconstructPoint(pdata.plateId || 0, pdata.lat, pdata.lng, reconCurrentTime);
            if (reconProjectionMode === 'mollweide') {
              reconFlatMap.focus(paleoPos.lat,paleoPos.lng);
              return;
            }
            const pointDir = reconLatLngToVec3(paleoPos.lat, paleoPos.lng, 1.0);
            const spherical = new THREE.Spherical().setFromVector3(pointDir);
            const dist = reconCamera.position.distanceTo(new THREE.Vector3(0, 0, 0));
            reconFocusLocation = paleoPos;
            if (reconLocalView) reconSetTerrainView(true,paleoPos);
            else { reconCamera.position.setFromSphericalCoords(dist,spherical.phi,spherical.theta); reconControls.target.set(0,0,0); reconControls.update(); }
          }, 100);

          // Show popup at the point's projected screen position (same as clicking on globe)
          setTimeout(() => {
            const screenPos = reconProjectPointToScreen(pdata.plateId || 0, pdata.lat, pdata.lng, reconCurrentTime);
            reconShowPopup(
              { id: pt.id, plateId: pdata.plateId || 0, lat: pdata.lat, lng: pdata.lng, timeBegin: pdata.timeBegin, timeEnd: pdata.timeEnd },
              screenPos.x, screenPos.y
            );
          }, 200);
        });
        pointItemsCont.appendChild(item);
      });

      // Click header to toggle points visibility (accordion: close other expanded epochs)
      epochHeader.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpening = !pointItemsCont.classList.contains('open');
        // Close all other expanded epoch point items
        document.querySelectorAll('.recon-epoch-point-items.open').forEach(el => {
          el.classList.remove('open');
          const header = el.previousElementSibling;
          if (header) {
            const icon = header.querySelector('.toggle-icon i');
            if (icon) {
              icon.classList.remove('fa-chevron-down');
              icon.classList.add('fa-chevron-right');
            }
          }
        });
        if (isOpening) {
          pointItemsCont.classList.add('open');
          const icon = epochHeader.querySelector('.toggle-icon i');
          if (icon) {
            icon.classList.remove('fa-chevron-right');
            icon.classList.add('fa-chevron-down');
          }
        }
      });

      epochGroup.appendChild(epochHeader);
      epochGroup.appendChild(pointItemsCont);
      epochPointsCont.appendChild(epochGroup);
    });

    periodDiv.appendChild(header);
    periodDiv.appendChild(epochPointsCont);
    container.appendChild(periodDiv);
  }
}

// ============ Time control ============
function reconSetTime(time) {
  reconCurrentTime = Math.round(Math.max(0, Math.min(540, time)) * 1000) / 1000;
  const slider = document.getElementById('reconTimeSlider');
  const timeDisplay = document.getElementById('reconTimeDisplay');
  const eraDisplay = document.getElementById('reconEraDisplay');
  const timeProgressBar = document.getElementById('reconTimeProgressBar');
  if (slider) slider.value = reconCurrentTime;
  if (timeDisplay) timeDisplay.textContent = `${reconCurrentTime} Ma`;
  if (eraDisplay) eraDisplay.textContent = reconGetEraName(reconCurrentTime);
  if (timeProgressBar) timeProgressBar.style.width = (reconCurrentTime / 540 * 100) + '%';
  reconUpdateProjection(reconCurrentTime);

  reconRotationCache.clear();
  reconRebuildPlates(reconCurrentTime);
  reconUpdateAllPointPositions(reconCurrentTime);
  if(reconSelectedPlate!==null) reconShowPlateInfo(reconSelectedPlate);

  return reconUpdateRaster(reconCurrentTime);
}


function reconStopPlayback() {
  reconPlaying = false;
  if (reconPlayInterval) { clearInterval(reconPlayInterval); reconPlayInterval = null; }
  const playBtn = document.getElementById('reconBtnPlay');
  const pauseBtn = document.getElementById('reconBtnPause');
  if (playBtn) playBtn.disabled = false;
  if (pauseBtn) pauseBtn.disabled = true;
}

function reconStartPlayback() {
  reconStopPlayback();
  reconHidePopup();
  reconPlaying = true;
  const playBtn = document.getElementById('reconBtnPlay');
  const pauseBtn = document.getElementById('reconBtnPause');
  if (playBtn) playBtn.disabled = true;
  if (pauseBtn) pauseBtn.disabled = false;

  reconPlayInterval = setInterval(() => {
    if (!reconPlaying) return;
    reconCurrentTime += reconPlaySpeed;
    if (reconCurrentTime > 540) { reconCurrentTime = 540; reconStopPlayback(); }
    reconSetTime(reconCurrentTime);
  }, 250);
}

// ============ Keyboard controls ============
function reconHandleKeydown(e) {
  if (document.getElementById('reconstruction-page').classList.contains('page-hidden') || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if(e.key === 'Escape') { reconHidePopup(); reconHidePlatePopup(); }
  switch(e.key.toLowerCase()) {
    case 'r':
      if (reconControls) reconControls.autoRotate = !reconControls.autoRotate;
      break;
    case '0':
      reconSetTime(0);
      break;
    case 'arrowleft':
      reconSetTime(reconCurrentTime - 10);
      break;
    case 'arrowright':
      reconSetTime(reconCurrentTime + 10);
      break;
  }
}

// ============ Data loading ============
async function reconLoadJSON(path) {
  const resp = await fetch(path + '?v=' + Date.now());
  if (!resp.ok) throw new Error(`Failed to load ${path}`);
  return resp.json();
}

function reconUpdateProgress(percent, text) {
  const bar = document.getElementById('reconProgressBar');
  const loadingText = document.getElementById('reconLoadingText');
  if (bar) bar.style.width = percent + '%';
  if (loadingText) loadingText.textContent = text;
}

async function reconLoadAllData() {
  try {
    reconUpdateProgress(10, 'Loading rotation model...');
    reconRotations = await reconLoadJSON('paleo_rotations_absolute.json');
    for (const pid in reconRotations) {
      reconRotations[pid].reverse();
    }
    reconUpdateProgress(30, `Rotation model: ${Object.keys(reconRotations).length} plates`);

    reconUpdateProgress(35, 'Loading fire point data...');
    // Excel: 表格_2026-09-18.xlsx / Paleowildfire Records.
    // IDs match paleo_data.json; coordinates and age bounds use the source table.
    reconPointsData = await reconLoadJSON('paleo_points_full.json');
    reconUpdateProgress(55, `Fire points: ${reconPointsData.length} entries`);

    // Data record #5 (Winnica, Poland) is explicitly bound to plate 301.
    const point5 = reconPointsData.find(p => p.id === 5);
    if (point5) {
      point5.plateId = 301;
    }

    reconUpdateProgress(60, 'Loading plate polygons...');
    reconPlatePolygons = await reconLoadJSON('paleo_polygons.json');
    reconPlateFootprints = reconPlatePolygons.map(p=>(p.rings || [p.vertices]).map(makePlateFootprint));
    reconPolygonActivity = await reconLoadJSON('paleo_polygon_activity.json');
    reconUpdateProgress(75, `Plate boundaries: ${reconPlatePolygons.length} polygons`);

    reconUpdateProgress(80, 'Loading raster index...');
    reconRasters = await reconLoadJSON('paleo_rasters.json');
    const terrainIndex = await reconLoadJSON('assets/paleodem-index.json');
    reconDemFrames = terrainIndex.frames;
    reconElevationShape = terrainIndex.elevationGrid;
    reconUpdateProgress(90, `Rasters: ${reconRasters.length} images`);

    reconUpdateProgress(95, 'Creating 3D visualization...');

    reconPointMeshGroup = reconCreateAllPointMarkers(reconPointsData);
    reconEarth.add(reconPointMeshGroup);

    await reconSetTime(300);

    reconUpdateProgress(100, 'Initialization complete');

    const infoEl = document.getElementById('reconDatasetInfo');
    if (infoEl) infoEl.textContent = `${reconPointsData.length.toLocaleString('en-US')} records · ${reconDemFrames.length} terrain slices | Scotese & Wright (2018)`;

    setTimeout(() => {
      const loadingOverlay = document.getElementById('recon-loading-overlay');
      if (loadingOverlay) {
        loadingOverlay.style.opacity = '0';
        loadingOverlay.style.transition = 'opacity 0.5s';
        setTimeout(() => { loadingOverlay.style.display = 'none'; }, 500);
      }
    }, 300);

    return true;
  } catch (err) {
    console.error('Data loading failed:', err);
    const loadingText = document.getElementById('reconLoadingText');
    if (loadingText) { loadingText.textContent = 'Loading failed: ' + err.message; loadingText.style.color = '#ff6b6b'; }
    return false;
  }
}

// ============ Animation loop ============
function reconAnimationLoop() {
  reconAnimFrameId = requestAnimationFrame(reconAnimationLoop);
  if (document.getElementById('reconstruction-page').classList.contains('page-hidden') || reconProjectionMode === 'mollweide') return;
  if (reconControls) reconControls.update();
  if(reconCamera && reconCurrentRasterMesh){
    const minimum=(reconCurrentRasterMesh.userData.maxRadius || 1)+.035;
    if(reconCamera.position.length()<minimum) reconCamera.position.setLength(minimum);
  }
  if (reconRenderer && reconScene && reconCamera) {
    reconRenderer.render(reconScene, reconCamera);
  }
}

// ============ Init function (exposed to window) ============
async function initReconstructionGlobe() {
  if (reconInitialized) return;
  reconInitialized = true;

  const container = document.getElementById('recon-globe-container');
  if (!container) return;

  reconFlatMap = new MollweideMap(document.getElementById('recon-mollweide-canvas'), ({records,plateId,location,event})=>{
    if(records?.length) {reconShowRecordSelection(records,event.clientX,event.clientY);return;}
    reconHidePopup();
    if(reconShowPlates && location) {
      const id=plateId ?? reconPickPlate(reconLatLngToVec3(location.lat,location.lng,1));
      if(id!==null)reconShowPlateInfo(id);
      else {reconHidePlatePopup();document.getElementById('recon-plate-hint').textContent='No model polygon at this location.';}
    }
  });
  document.getElementById('recon-flat-zoom-in').addEventListener('click',()=>reconFlatMap.scale(1.4));
  document.getElementById('recon-flat-zoom-out').addEventListener('click',()=>reconFlatMap.scale(1/1.4));
  document.getElementById('recon-flat-reset').addEventListener('click',()=>reconFlatMap.reset());

  // Three.js setup
  reconScene = new THREE.Scene();
  reconCamera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.003, 100);
  const fitDistance = () => {
    const diameter = Math.min(container.clientWidth * .85, container.clientHeight * .68);
    return Math.sqrt(1 + Math.pow(container.clientHeight / (diameter * Math.tan(Math.PI / 8)), 2));
  };
  let fittedDistance = fitDistance();
  reconCamera.position.copy(reconLatLngToVec3(-8, -15, fittedDistance));

  reconRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  reconRenderer.setClearColor(0x070d15, 1);
  reconRenderer.setSize(container.clientWidth, container.clientHeight);
  reconRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(reconRenderer.domElement);

  reconControls = new OrbitControls(reconCamera, reconRenderer.domElement);
  reconControls.enableDamping = true;
  reconControls.dampingFactor = 0.08;
  reconControls.minDistance = 1.18;
  reconControls.enablePan = false;
  reconControls.maxDistance = 12;
  reconControls.autoRotate = false;

  // Stable camera-relative lighting keeps the scientific terrain readable.
  reconScene.add(new THREE.AmbientLight(0xddeaff, .52));
  const keyLight = new THREE.DirectionalLight(0xfff3de, 2.1);
  keyLight.position.set(-4, 5, 3); reconCamera.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x81b3db, .23);
  fillLight.position.set(4, 0, 2); reconCamera.add(fillLight);
  reconScene.add(reconCamera);

  // Stars
  const starsGeo = new THREE.BufferGeometry();
  const starPositions = new Float32Array(3000 * 3);
  for (let i = 0; i < 3000; i++) {
    starPositions[i * 3] = (Math.random() - 0.5) * 50;
    starPositions[i * 3 + 1] = (Math.random() - 0.5) * 50;
    starPositions[i * 3 + 2] = (Math.random() - 0.5) * 50;
  }
  starsGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(starsGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.014, transparent: true, opacity: 0.48 }));
  reconScene.add(stars);

  // Earth
  const earthGeo = new THREE.SphereGeometry(.78, 48, 32);
  const earthMat = new THREE.MeshPhongMaterial({ color: 0x1a3a5c, specular: 0x222244, shininess: 10, emissive: 0x050515 });
  reconEarth = new THREE.Mesh(earthGeo, earthMat);
  reconScene.add(reconEarth);

  // Latitude / Longitude grid lines
  function reconCreateLatLngGrid(radius, latStep, lngStep, color, opacity) {
    const gridGroup = new THREE.Group();
    const mat = new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: opacity, depthTest: true });
    const ptsPerCircle = 128;
    // Latitude lines (parallels)
    for (let lat = -90 + latStep; lat <= 90 - latStep; lat += latStep) {
      const phi = (90 - lat) * Math.PI / 180;
      const r = radius * Math.sin(phi);
      const y = radius * Math.cos(phi);
      const circlePts = [];
      for (let i = 0; i <= ptsPerCircle; i++) {
        const theta = (i / ptsPerCircle) * Math.PI * 2;
        circlePts.push(new THREE.Vector3(r * Math.cos(theta), y, r * Math.sin(theta)));
      }
      gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(circlePts), mat));
    }
    // Longitude lines (meridians)
    const halfPts = 64;
    for (let lng = 0; lng < 360; lng += lngStep) {
      const theta = lng * Math.PI / 180;
      const meridianPts = [];
      for (let i = 0; i <= halfPts; i++) {
        const phi = (i / halfPts) * Math.PI;
        meridianPts.push(new THREE.Vector3(
          radius * Math.sin(phi) * Math.cos(theta),
          radius * Math.cos(phi),
          radius * Math.sin(phi) * Math.sin(theta)
        ));
      }
      gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(meridianPts), mat));
    }
    return gridGroup;
  }
  reconGridGroup = reconCreateLatLngGrid(1.009, 30, 30, 0xa8c7d5, 0.18);
  reconGridGroup.visible = false; reconScene.add(reconGridGroup);
  reconGridGroup.children.forEach(line=>{
    const p=line.geometry.attributes.position, directions=new Float32Array(p.count*3);
    for(let i=0;i<p.count;i++){const v=new THREE.Vector3().fromBufferAttribute(p,i).normalize();directions.set([v.x,v.y,v.z],i*3);}
    line.userData.surfaceDirections=directions;
  });

  // Ignore orbit drags; keep record and plate selection available on both views.
  let pointerStart=null;
  reconRenderer.domElement.addEventListener('pointerdown',event=>{pointerStart={x:event.clientX,y:event.clientY};});
  reconRenderer.domElement.addEventListener('click',event=>{
    if(!pointerStart || Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)>6) return;
    const hits=reconGetIntersections(event);
    if(hits.length){reconShowRecordSelection(hits.map(hit=>hit.record),event.clientX,event.clientY);return;}
    reconHidePopup();
    if(reconShowPlates){
      const hit=reconGetSurfaceHit(event);
      if(hit){
        let id=reconPickPlate(hit.point);
        if(id===null){
          reconRaycaster.params.Line.threshold=.009;
          const edges=reconRaycaster.intersectObjects(reconPlateLineMeshes,false).filter(h=>h.distance<=hit.distance+.02);
          if(edges.length) id=edges[0].object.userData.plateId;
        }
        if(id!==null){reconShowPlateInfo(id);return;}
      }
      reconHidePlatePopup();
      document.getElementById('recon-plate-hint').textContent='No model polygon here. Click a white outline.';
    }
  });
  reconRenderer.domElement.addEventListener('dblclick',event=>{
    const hit=reconGetSurfaceHit(event);
    if(hit){reconHidePopup();reconHidePlatePopup();reconSetTerrainView(true,reconDirectionLocation(hit.point));}
  });
  reconRenderer.domElement.addEventListener('mousemove',event=>{
    reconRenderer.domElement.style.cursor=reconShowPlates || reconGetIntersections(event).length?'pointer':'grab';
  });

  // UI control bindings
  const slider = document.getElementById('reconTimeSlider');
  if (slider) slider.addEventListener('input', () => {
    reconHidePopup();
    reconStopPlayback();
    reconSetTime(parseFloat(slider.value));
  });

  const playBtn = document.getElementById('reconBtnPlay');
  if (playBtn) playBtn.addEventListener('click', reconStartPlayback);

  const pauseBtn = document.getElementById('reconBtnPause');
  if (pauseBtn) pauseBtn.addEventListener('click', reconStopPlayback);

  const resetBtn = document.getElementById('reconBtnReset');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    reconStopPlayback();reconSetTime(0);
  });

  const speedDown = document.getElementById('reconBtnSpeedDown');
  if (speedDown) speedDown.addEventListener('click', () => {
    reconPlaySpeed = Math.max(0.25, reconPlaySpeed / 2);
    const speedDisplay = document.getElementById('reconSpeedDisplay');
    if (speedDisplay) speedDisplay.textContent = reconPlaySpeed + 'x';
  });

  const speedUp = document.getElementById('reconBtnSpeedUp');
  if (speedUp) speedUp.addEventListener('click', () => {
    reconPlaySpeed = Math.min(16, reconPlaySpeed * 2);
    const speedDisplay = document.getElementById('reconSpeedDisplay');
    if (speedDisplay) speedDisplay.textContent = reconPlaySpeed + 'x';
  });

  // Keyboard
  window.addEventListener('keydown', reconHandleKeydown);

  // Observe the actual stage, including mobile navigation and page changes.
  const resizeGlobe = () => {
    if (!container.clientWidth || !container.clientHeight) return;
    const nextDistance = fitDistance();
    if (!reconLocalView) reconCamera.position.multiplyScalar(nextDistance / fittedDistance);
    fittedDistance = nextDistance;
    reconCamera.aspect = container.clientWidth / container.clientHeight;
    reconCamera.setViewOffset(container.clientWidth, container.clientHeight, 0, 60, container.clientWidth, container.clientHeight);
    reconCamera.updateProjectionMatrix();
    reconRenderer.setSize(container.clientWidth, container.clientHeight);
  };
  window.addEventListener('resize', resizeGlobe);
  new ResizeObserver(resizeGlobe).observe(container);
  reconBindLayerControls();
  reconBindTerrainControls();


    const success = await reconLoadAllData();
  if (success) {
    try {
      reconBuildPointLookup();
      reconBuildSidebar();
      const empty = document.createElement('p'); empty.id = 'recon-search-empty'; empty.className = 'recon-search-empty'; empty.textContent = 'No matching records.'; empty.hidden = true;
      document.getElementById('recon-strata-list').appendChild(empty);
      window.makeKeyboardClickable?.(document.querySelectorAll('.recon-period-header, .recon-epoch-group-header, .recon-point-item'));
      reconFilterDirectory();
    } catch (e) {
      console.warn('Sidebar build failed (globalJson may not be loaded yet):', e);
    }
    reconAnimationLoop();
  }
}

window.initReconstructionGlobe = initReconstructionGlobe;
window.pauseReconstruction = reconStopPlayback;
window.resolveReconstructionReady(true);
