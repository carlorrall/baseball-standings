# Baseball · MLB Standings

A single spinning 3D baseball on the front page. Click it to open the 2026 MLB
standings, and switch between the American and National League (East / Central / West).

## Run it

Open `index.html` in a browser — no server needed. (Or host the folder anywhere static.)

## Edit it

```
src/data.js       fetches live standings + postseason series from the MLB Stats API
src/ball.js       the three.js baseball (leather texture, seam, stitches, lighting)
src/standings.js  renders division + wild-card tables, the postseason bracket and games, tabs
src/main.js       view routing (#/standings/al, #/standings/nl, #/postseason)
styles.css        all styling
app.js            built bundle (generated)
```

```
npm install
npm run build     # rebuild app.js + standalone.html after editing src/
npm run watch     # rebuild on save
```

`standalone.html` is the same site in one file (script and styles inlined).

Data: live from `statsapi.mlb.com/api/v1/standings` (current season; falls back to last
season before opening day). Team logos load from `mlbstatic.com`. Rows are colour-coded by
MLB's clinch indicators: z best record in league, y division, w wild card, x playoff berth,
e eliminated. An internet connection is needed to see the standings.
