// Geographic helpers shared by the displaced surface and plate picking.
export function sampleElevation(grid, lat, lon) {
  if (!grid) return 0;
  const x = (((lon + 180) % 360 + 360) % 360) / 360 * (grid.width - 1);
  const y = Math.max(0, Math.min(grid.height - 1, (90 - lat) / 180 * (grid.height - 1)));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, grid.width - 1), y1 = Math.min(y0 + 1, grid.height - 1);
  const fx = x - x0, fy = y - y0, values = grid.values, w = grid.width;
  return (values[y0*w+x0]*(1-fx)+values[y0*w+x1]*fx)*(1-fy)
    +(values[y1*w+x0]*(1-fx)+values[y1*w+x1]*fx)*fy;
}

export function geographicUnit(lat, lon) {
  const p = lat*Math.PI/180, l = lon*Math.PI/180;
  return [Math.cos(p)*Math.cos(l), Math.cos(p)*Math.sin(l), Math.sin(p)];
}

export function makePlateFootprint(vertices) {
  const vectors = vertices.map(([lat, lon]) => geographicUnit(lat, lon));
  const center = vectors.reduce((sum, p) => sum.map((v, i) => v+p[i]), [0,0,0]);
  return {vectors, center};
}

export function footprintContains(footprint, point) {
  const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  // The supplied PALEOMAP fragments each occupy less than a hemisphere.
  // This rejects the antipodal solution of a spherical winding calculation.
  if (dot(footprint.center, point) <= 0) return false;
  let winding = 0;
  const v = footprint.vectors;
  for (let i=0; i<v.length; i++) {
    const a = v[i], b = v[(i+1)%v.length];
    const cross = [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    winding += Math.atan2(dot(point,cross), dot(a,b)-dot(a,point)*dot(b,point));
  }
  return Math.abs(winding) > Math.PI;
}
