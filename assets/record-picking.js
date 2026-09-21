// All tolerances are CSS pixels, independent of map zoom or display pixel ratio.
export function pickScreenRecords(points,x,y,radius=14) {
  return points.map(p=>({...p,distance:Math.hypot(p.x-x,p.y-y)}))
    .filter(p=>p.distance<=radius).sort((a,b)=>a.distance-b.distance||a.record.id-b.record.id);
}

export function clusterScreenRecords(points,radius=14) {
  const groups=[];
  for(const point of points) {
    const group=groups.find(g=>Math.hypot(g.x-point.x,g.y-point.y)<=radius);
    if(group) group.records.push(point.record);
    else groups.push({x:point.x,y:point.y,records:[point.record]});
  }
  return groups;
}
