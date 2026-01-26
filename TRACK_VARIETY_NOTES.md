# Track Variety - What We Tried

This document tracks our experiments with procedural track generation, particularly around creating exciting, varied tracks without self-intersections or straight segments.

## The Core Challenge

Rally games need:
- **Exciting tracks**: Hairpins, tight corners, technical sections
- **No self-intersections**: Track should never loop over itself
- **No long straights**: Boring sections kill the rally feel
- **Varied surfaces**: Random surface order (tarmac, gravel, dirt, ice)

These requirements are in tension - hairpins naturally want to loop back!

## Visual Design Rules (Important)

### Road color must be predictable
- Road segment colors are derived only from the surface type (tarmac/gravel/dirt/ice).
- Track theme/type must never recolor the road, because players learn surface→handling by color.

### Theme lives under/around the road
- Track type “flavor” is expressed as a solid terrain underlay beneath/around the road (and in the minimap/background palette).
- The far world background can stay dark/neutral so the road remains readable.

### Zones should not break readability
- Zones should communicate via minimap overlays and lightweight screen-space effects, not by recoloring the road.

## Approaches Tried

### 1. Random Angle Budget System (Failed)
**What**: Each segment gets a random angle, total budget prevents excessive turning
**Problems**:
- Budget exhausted early → last third of track completely flat
- Front-loaded curves, then 416m+ straight sections
- No way to ensure curves throughout entire track

### 2. Distributed Angle Budget (Failed)
**What**: Budget divided evenly across segments (per-segment max)
**Tried**: 3.5π, 10.5π budgets
**Problems**:
- Low budgets (3.5π): Too conservative, tracks boring
- High budgets (10.5π): 90% of tracks had self-intersections
- Still got 300m+ flat sections at the end

### 3. Self-Intersection Avoidance via Collision Checks (Partial)
**What**: Check if new point would be too close to any previous point
**Approaches**:
- Check ALL previous points → too restrictive, generator gives up
- Check only within radius (100-180m) → better but still issues
- "Turn away" when close → creates weird jagged paths

**Problems**:
- Checking becomes more restrictive as track grows
- By the end, so many points to avoid that it goes straight
- Trade-off between safety and variety

### 4. Corner-Based System (Current - Works but Boring)
**What**: Pre-define corner types, place them strategically
**Corner Types**:
- Hairpin: ~178° over 6 control points
- Sharp: ~90° over 3 points  
- Medium: ~63° over 2 points
- Gentle: ~36° over 2 points
- Chicane: S-turn that returns to original angle

**Implementation**:
- Plan 5-7 corners at generation start
- Distribute them throughout track length
- Add gentle meandering between corners
- Collision check reduces turns when too close to old track

**With Retry Logic**:
- Try up to 15 attempts to generate track
- Reject if has self-intersections OR long straights (>100m)
- Keep first "good" track found

**Results**:
- ✅ Zero self-intersections (0/500 tracks fail)
- ✅ No long straights (0/100 tracks fail)
- ❌ Tracks are samey and boring
- ❌ Hairpins mostly rejected (they often cause loops)
- ❌ Only "safe" tracks pass quality checks

## Why Corner-Based + Retry Fails

The retry logic creates a **selection bias**:
- Interesting tracks (with hairpins) → often loop → rejected
- Boring tracks (gentle curves only) → never loop → accepted
- Result: Only the dullest 10-20% of generated tracks make it through

**Specific Issue with Hairpins**:
- Hairpins (178°) almost reverse direction
- On long tracks, reversing often brings you near where you've been
- Self-intersection check triggers → track rejected
- Fewer hairpins make it through → boring

## What We Learned

### Things That Work:
1. **Longer tracks** (1000-1600m) give more space for turns
2. **Fewer total corners** (5-7) reduces overlap probability
3. **Spatial filtering** (check only nearby points) is faster than checking all
4. **"Turn away" strategy** better than just reducing turns
5. **Predefined corner types** easier to reason about than random angles
6. **Metadata for pacenotes** much more accurate than curvature detection

### Things That Don't Work:
1. **Retry logic with strict checks** → kills variety
2. **High angle budgets** → guaranteed self-intersections
3. **Checking all previous points** → becomes straight at end
4. **Reducing turns when too close** → flat sections

## Potential Better Solutions (Untried)

### Option A: Zoned Track Layout
1. Divide track into spatial zones (grid or sectors)
2. Plan hairpins only in zones far from start/other hairpins
3. Guarantee no zone contains overlapping track segments
4. More predictable, less trial-and-error

### Option B: Outward Spiral Pattern
1. Start at origin, always move generally "outward"
2. Track a rough target direction that spirals out
3. Hairpins allowed as long as they don't point back toward center
4. Guarantees separation by design, not by checking

### Option C: Graph-Based Waypoints
1. Generate waypoints connected by edges (graph structure)
2. Plan path through graph from start to end
3. Convert waypoints to smooth track with known safe routing
4. Similar to how racing games manually design tracks

### Option D: Accept Visual Overlaps
1. Allow tracks to visually cross (overpasses/underpasses visual effect)
2. Collision detection only on "current" segment
3. More variety, interesting layouts
4. Rally stages in real life sometimes have roads crossing nearby!

### Option E: Relaxed Quality Checks
1. Allow occasional visual intersections if not driveable overlaps
2. Only reject if actual road surfaces would merge (< 1 track width apart)
3. Check straightness only in middle sections, allow straights at start/end
4. Accept 95% quality instead of 100%

## Current State

**Production**: Using corner-based with retry logic
- 100% reliable (no broken tracks)
- 0% exciting (hairpins rarely survive)

**Recommendation for Next Session**: Try Option D or E first (quickest wins), then Option A if more structure needed.
