# GPPD website assets

`site.css` contains the responsive visual design; `app.js` handles navigation,
the Data explorer and Statistics. `reconstruction.js` renders the
interactive globe and preserves the existing plate rotation model.

## Record details and website copy

`paleo_data.json` includes `lithostratigraphicUnit`, matched by the original
record ID to column M (`Unit`) of the supplied 2026-09-18 workbook,
sheet `Paleowildfire Records`. There are 893 populated units and 149 source
hyphens stored as `null` and displayed as an em dash. Unit names retain the
source spelling; missing values are not inferred from nearby rows.
The Data table and map popups, 3D globe popups and Mollweide popups all use
this field. Record searches include the unit name. The reconstruction coordinate,
age and plate files retain their existing values, including record 5 / plate 301.

Homepage and module descriptions are excerpts from the user's supplied database
methods text. Narrative excerpts have `data-source-copy` attributes for auditing.
The current module entrances are Data, Reconstruction and Statistics; removed
Evolution imagery and the four-module description are not advertised.

## Paleotopography

The 109 terrain frames come from the supplied **Scotese & Wright (2018),
PALEOMAP PaleoDEMs** NetCDF files, covering 0–540 Ma at 5 Ma intervals.
The original grids contain elevation in metres on a 0.1° grid
(1801 latitude samples × 3601 longitude samples).

- `terrain/NNNma.jpg`: 4096 × 2048 elevation colours with northwest hillshade
  and bounded local relief contrast, derived only from the native DEM.
- `terrain/NNNma-height.png`: legacy preview assets; the current renderer does not use these 8-bit height images.
- `paleodem-index.json`: source filenames, original descriptions, nominal ages,
  elevation ranges, and texture paths.
- `terrain/NNNma-elevation.bin.gz`: 3601 × 1801 signed 16-bit metre elevations,
  stored little-endian and gzip-compressed; grid shape and coordinates are in the index.
- `data-map-preview.webp`: screenshot of the Data page's satellite map and records.
- `reconstruction-5ma-preview.webp`: screenshot of the 5 Ma globe, facing Asia.
- The homepage hero uses the original `figure/cover.jpg`.

The three module cards sit inside the homepage cover, with responsive sizing,
entry and hover animations, and reduced-motion support. The Statistics card
uses the existing transparent fossil charcoal image on a dark blue background.

The textures use equirectangular coordinates: north at the top, west to east
from −180° to +180°. The age is the nominal age in the source filename;
original source descriptions are retained because some metadata ages differ.
The globe uses the nearest available terrain slice and labels its age separately
from the exact reconstruction age. It does not interpolate terrain between maps.

The terrain now displaces the sphere vertices using the sampled elevations. The 3D surface uses the exact source grid for sampling; its desktop mesh is 2048 × 1024 and its phone mesh is 1024 × 512.
The browser colour texture is 4096 × 2048. Lighting normals are calculated in the
fragment shader from the full 3601 × 1801 elevation grid, packed losslessly into
two byte channels. They follow the vertical exaggeration and seafloor switches.
Geometry normals and the geographic seam are stitched as well.
The source is a reconstructed 0.1° model, not present-day satellite imagery;
resampling and zoom cannot recover details absent from the original data.
The colour shading highlights existing ridges and valleys in both projections;
it does not change source elevations. The globe uses a matte surface to avoid
gloss obscuring terrain detail. The 0 Ma map contains finer terrain features
than many ancient reconstructions despite sharing the same grid spacing.

The displayed vertical exaggeration is configurable from 1× to 60× (default
18×), with 1× using Earth's 6,371 km radius. "Seafloor relief" shows negative
elevations as depressions; switching it off displays ocean areas at sea level.
"3D terrain" can return the entire surface to a sphere. Globe and tilted terrain
views share the same data, and double-clicking the surface focuses a local view.
Elevation-based geometry is only available with the Paleotopography basemap.
The **Mollweide** equal-area projection reprojects the current terrain or atlas
raster. It shares reconstructed record coordinates and plate outlines with the
globe, including click inspection, age changes, layer switches, pan and zoom.
The map splits lines at the antimeridian and supports the entire 0–540 Ma interval.

Record picking uses a 14 CSS-pixel radius in both projections, independent of
zoom and display pixel ratio. Mollweide markers have 28-pixel button targets
and count badges for nearby records. Overlapping records can be selected
individually in the details dropdown. Small pointer movements remain clicks;
dragging pans the map without selecting a record. Buttons also support keyboard
selection.

Wildfire markers, the coordinate grid, and white plate outlines are positioned
on the displaced surface. The original rotation model, point IDs, and explicit
record 5 / plate 301 binding are preserved. Plate picking applies the inverse
Euler rotation and a spherical polygon containment calculation, including the
antimeridian. The plate inspector reports only fields actually present in the
source model; the GPML file has no populated plate names/descriptions, so labels
such as `Plate_301` are retained. The white outlines are reconstructed model
polygons, not newly inferred subduction or spreading boundaries.

## Running and copying the website

Serve the complete `web` directory over HTTP, for example with a local static
server. Copy `assets` together with `index.html`, the root data JSON files, and
the existing `plates` and image/data directories. Opening the HTML
directly with a `file://` URL can block JSON requests and JavaScript modules.
The original NetCDF files are not needed by the browser.

Leaflet, Chart.js, Three.js, icon fonts, and modern map tiles currently load from
their existing external services. OpenStreetMap is the default modern basemap;
Esri satellite imagery is available through the map layer picker.

## Plate geometry

Native GPML `gml:validTime` and `reconstructionPlateId` are retained
(the imported shapefile attributes can be stale). Feature validity is stored in `paleo_polygon_activity.json`. The 12 multipart
features retain their separate polygon rings in `paleo_polygons.json`; these must
never be joined end to end. All small fragments are retained, exact repeated edges
within a plate are drawn once, and only age-valid fragments are shown. Source
fragments can overlap and are not a resolved topological plate-boundary network.

0.1° describes model sampling, about 11.1 km north–south and at the equator.
It does not imply measured terrain detail at that scale, especially in deep time.
The native DEM shader adds no synthetic mountains or noise.
