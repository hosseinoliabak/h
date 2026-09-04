/**
 * Oliabak shape library.
 *
 * Added 2026-09-04 by Hossein Oliabak as part of Diagrams.
 * Licensed under the Apache License 2.0.
 *
 * Original work for this fork; not derived from an upstream draw.io file.
 * Shapes live under the mxgraph.oliabak.* namespace, which upstream does not
 * use, so a rebase can never collide with it.
 *
 * Contents:
 *   mxgraph.oliabak.arc        curved connector, one bow handle (symmetric)
 *   mxgraph.oliabak.scurve     curved connector, two independent bow handles
 *   mxgraph.oliabak.tunnel     see-through tube on a bowed centre line,
 *                              straight at zero curvature
 */
(function()
{
	// Percentage of the chord length used as the default bow.
	var DEFAULT_BOW = 30;

	// Depth of the open end as a fraction of its radius. Low enough to read
	// as a tube seen at an angle rather than a disc seen head on.
	var OPENING_DEPTH = 0.42;

	// Cubic control-handle length for a circular arc of angle a (radians).
	// The 4/3 tan(a/4) form is exact at the endpoints and within 0.02% of the
	// true circle for the 90-degree segments this file emits.
	function arcHandle(a)
	{
		return 4 / 3 * Math.tan(a / 4);
	};

	/**
	 * Emits a circular arc about the origin as cubic segments, from angle a0
	 * to a1 in radians, as [[c1x, c1y, c2x, c2y, x, y], ...]. Segments are
	 * capped at a quarter turn, where the cubic approximation of a circle is
	 * still visually exact, and the sweep may run either way.
	 */
	function arcCurves(r, a0, a1)
	{
		var sweep = a1 - a0;
		var steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
		var step = sweep / steps;
		var k = arcHandle(step) * r;
		var out = [];

		for (var i = 0; i < steps; i++)
		{
			var s = a0 + step * i;
			var e = s + step;
			var sx = Math.cos(s) * r, sy = Math.sin(s) * r;
			var ex = Math.cos(e) * r, ey = Math.sin(e) * r;

			// The tangent is the radius turned a quarter turn, signed by the
			// direction of the sweep.
			out.push([sx - Math.sin(s) * k, sy + Math.cos(s) * k,
				ex + Math.sin(e) * k, ey - Math.cos(e) * k, ex, ey]);
		}

		return out;
	};

	/**
	 * Mixes a hex colour towards white (amount > 0) or black (amount < 0).
	 * Returns the input unchanged if it is not a plain #rgb or #rrggbb value,
	 * so named colours and 'none' pass through instead of turning into NaN.
	 */
	function shade(color, amount)
	{
		if (typeof color !== 'string')
		{
			return color;
		}

		var hex = color.charAt(0) == '#' ? color.substring(1) : null;

		if (hex != null && hex.length == 3)
		{
			hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) +
				hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
		}

		if (hex == null || hex.length != 6 || !/^[0-9a-fA-F]{6}$/.test(hex))
		{
			return color;
		}

		var target = amount > 0 ? 255 : 0;
		var t = Math.abs(amount);
		var out = '#';

		for (var i = 0; i < 3; i++)
		{
			var v = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
			v = Math.round(v + (target - v) * t);
			out += ('0' + Math.max(0, Math.min(255, v)).toString(16)).slice(-2);
		}

		return out;
	};

	// ---------------------------------------------------------------------
	// Curved connectors
	// ---------------------------------------------------------------------

	/**
	 * A connector drawn as a single cubic Bezier. The two control points sit
	 * at one third and two thirds along the chord, pushed sideways by 'bow'
	 * and 'bow2' percent of the chord length. Because both offsets are
	 * relative to the chord, the curve keeps its shape when either endpoint
	 * moves or the diagram is zoomed.
	 *
	 * With more than two points the edge has waypoints, and bowing individual
	 * segments would fight the route the user just drew. In that case this
	 * falls back to the stock smooth-polyline rendering.
	 */
	function mxShapeOliabakArc()
	{
		mxConnector.call(this);
	};

	mxUtils.extend(mxShapeOliabakArc, mxConnector);

	// Positive 'bow' and 'bow2' both push the same way, so the default is a
	// symmetric arc. The handle writes both keys together.
	mxShapeOliabakArc.prototype.symmetric = true;

	mxShapeOliabakArc.prototype.customProperties = [
		{name: 'bow', dispName: 'Curvature', type: 'float', min: -400, max: 400,
			defVal: DEFAULT_BOW}
	];

	/**
	 * Returns [p0, c1, c2, p3] in absolute coordinates, or null when the edge
	 * has waypoints or zero length.
	 */
	mxShapeOliabakArc.prototype.getBowPoints = function(pts)
	{
		if (pts == null || pts.length != 2 || pts[0] == null || pts[1] == null)
		{
			return null;
		}

		var p0 = pts[0];
		var p3 = pts[1];
		var dx = p3.x - p0.x;
		var dy = p3.y - p0.y;
		var len = Math.sqrt(dx * dx + dy * dy);

		if (len < 1)
		{
			return null;
		}

		var ux = dx / len;
		var uy = dy / len;
		// Left-hand normal, so a positive bow always bulges the same side
		// regardless of which way the edge was drawn.
		var nx = -uy;
		var ny = ux;

		var b1 = mxUtils.getValue(this.style, 'bow', DEFAULT_BOW) / 100 * len;
		var b2 = this.symmetric ? b1 :
			mxUtils.getValue(this.style, 'bow2', -DEFAULT_BOW) / 100 * len;

		return [p0,
			new mxPoint(p0.x + ux * len / 3 + nx * b1,
				p0.y + uy * len / 3 + ny * b1),
			new mxPoint(p0.x + ux * len * 2 / 3 + nx * b2,
				p0.y + uy * len * 2 / 3 + ny * b2),
			p3];
	};

	/**
	 * Runs the marker plumbing around a caller-supplied paint step.
	 *
	 * createMarker reads pts[0]/pts[1] for the start and pts[n-1]/pts[n-2] for
	 * the end to get the direction, and shortens the outer point so the line
	 * does not poke out through the arrowhead. It must therefore run before
	 * the line is painted, while the markers themselves are drawn after, with
	 * shadow and dash turned off so an arrowhead stays solid on a dashed line.
	 */
	mxShapeOliabakArc.prototype.paintWithMarkers = function(c, pts, paint)
	{
		var sourceMarker = this.createMarker(c, pts, true);
		var targetMarker = this.createMarker(c, pts, false);

		paint.call(this);

		c.setShadow(false);
		c.setDashed(false);

		if (sourceMarker != null)
		{
			c.setFillColor(mxUtils.getValue(this.style,
				mxConstants.STYLE_STARTFILLCOLOR, this.stroke));
			sourceMarker();
		}

		if (targetMarker != null)
		{
			c.setFillColor(mxUtils.getValue(this.style,
				mxConstants.STYLE_ENDFILLCOLOR, this.stroke));
			targetMarker();
		}
	};

	mxShapeOliabakArc.prototype.paintEdgeShape = function(c, pts)
	{
		var bp = this.getBowPoints(pts);

		if (bp == null)
		{
			// Waypoints present, or the edge is too short to have a direction.
			// Bowing each segment would fight the route the user just drew, so
			// run a spline through the points instead. Painting it curved
			// rather than deferring to mxPolyline is deliberate: a shape called
			// Curved Line should not straighten into corners just because the
			// stock curved style is off.
			this.paintWithMarkers(c, pts, function()
			{
				if (pts.length > 2)
				{
					this.paintCurvedLine(c, pts);
				}
				else
				{
					this.paintLine(c, pts, this.isRounded);
				}
			});

			return;
		}

		// Handing the markers the control points instead of the far endpoint
		// makes both arrowheads follow the curve's tangent, not the chord.
		var markerPts = [bp[0], bp[1], bp[2], bp[3]];

		this.paintWithMarkers(c, markerPts, function()
		{
			c.begin();
			c.moveTo(markerPts[0].x, markerPts[0].y);
			c.curveTo(bp[1].x, bp[1].y, bp[2].x, bp[2].y,
				markerPts[3].x, markerPts[3].y);
			c.stroke();
		});
	};

	// The curve leaves the chord's bounding box, so measure the painted
	// geometry instead. Without this the selection outline, hit area and
	// export crop all clip the bulge.
	mxShapeOliabakArc.prototype.updateBoundingBox = function()
	{
		this.useSvgBoundingBox = true;
		mxShape.prototype.updateBoundingBox.apply(this, arguments);
	};

	mxCellRenderer.registerShape('mxgraph.oliabak.arc', mxShapeOliabakArc);

	/**
	 * Same curve, but the two bows move independently, which is what makes an
	 * S, a hook or a lazy sweep possible.
	 */
	function mxShapeOliabakSCurve()
	{
		mxShapeOliabakArc.call(this);
	};

	mxUtils.extend(mxShapeOliabakSCurve, mxShapeOliabakArc);

	mxShapeOliabakSCurve.prototype.symmetric = false;

	mxShapeOliabakSCurve.prototype.customProperties = [
		{name: 'bow', dispName: 'Start Curvature', type: 'float', min: -400,
			max: 400, defVal: DEFAULT_BOW},
		{name: 'bow2', dispName: 'End Curvature', type: 'float', min: -400,
			max: 400, defVal: -DEFAULT_BOW}
	];

	mxCellRenderer.registerShape('mxgraph.oliabak.scurve', mxShapeOliabakSCurve);

	// ---------------------------------------------------------------------
	// Tunnel
	// ---------------------------------------------------------------------

	/**
	 * A tube swept along a bowed centre line, for drawing a VPN tunnel over a
	 * topology.
	 *
	 * The centre line is a cubic Bezier between the midpoints of two opposite
	 * edges, pushed sideways by 'tunnelBow'. Zero is a straight run, so one
	 * shape and one handle cover both a plain site to site tunnel and one that
	 * has to bend around whatever sits under it. The bow is a percentage of
	 * the clearance left between the tube and the cell edge, so the tunnel can
	 * bow to its limit without ever leaving its own bounds.
	 *
	 * Both ends are stroked ellipses with no fill, which reads as a tube you
	 * can see through rather than a capped pipe. That also keeps the shape to
	 * a single filled layer. It matters here: the palette style is half
	 * transparent, and stacked translucent fills would show up as darker
	 * patches wherever they overlapped. For the same reason the round tube
	 * shading is one gradient rather than the separate highlight bands an
	 * opaque shape could afford.
	 */
	function mxShapeOliabakTunnel(bounds, fill, stroke, strokewidth)
	{
		mxShape.call(this);
		this.bounds = bounds;
		this.fill = fill;
		this.stroke = stroke;
		this.strokewidth = (strokewidth != null) ? strokewidth : 1;
	};

	mxUtils.extend(mxShapeOliabakTunnel, mxShape);

	mxShapeOliabakTunnel.prototype.customProperties = [
		{name: 'tunnelBow', dispName: 'Curvature', type: 'float', min: -100,
			max: 100, defVal: 0},
		{name: 'tunnelWidth', dispName: 'Width', type: 'float', min: 0.05,
			max: 0.9, defVal: 0.45},
		{name: 'tunnelShading', dispName: 'Shading', type: 'float', min: 0,
			max: 1, defVal: 0.6},
		{name: 'tunnelEnds', dispName: 'Open Ends', type: 'bool', defVal: true}
	];

	// Outline samples along each side. Fixed rather than adaptive because the
	// centre line is a single gentle curve, where 64 segments stay under a
	// pixel of chord error at any size this shape is drawn at.
	var TUNNEL_STEPS = 64;

	// Depth of an end opening as a fraction of the tube radius. The same
	// foreshortening a cylinder uses, so a tunnel sits next to one without
	// looking like it is seen from a different angle.
	var TUNNEL_DEPTH = 0.38;

	/**
	 * Resolves the styled geometry once, so the outline, the end openings,
	 * the handles and the connection points cannot drift apart.
	 */
	mxShapeOliabakTunnel.prototype.getTunnelGeometry = function(style, x, y, w, h)
	{
		var tw = Math.max(0.05, Math.min(0.9,
			mxUtils.getValue(style, 'tunnelWidth', 0.45)));
		var bow = Math.max(-100, Math.min(100,
			mxUtils.getValue(style, 'tunnelBow', 0)));

		var thick = tw * h;
		var cy = y + h / 2;
		// What is left over once the tube itself is accounted for. Bowing by
		// the full 100 percent puts the tube's edge exactly on the cell edge.
		var clearance = (h - thick) / 2;
		var apex = bow / 100 * clearance;

		// For a cubic whose ends sit on the axis and whose control points are
		// both displaced by d, the midpoint lands at 0.75 * d. Scaling d by
		// 4/3 therefore makes 'apex' the true peak displacement rather than an
		// approximation of it.
		var d = 4 / 3 * apex;

		return {
			thick: thick, apex: apex, clearance: clearance, cy: cy,
			// Negative displacement, so a positive bow arches upwards.
			p0x: x, p0y: cy,
			c1x: x + w / 3, c1y: cy - d,
			c2x: x + w * 2 / 3, c2y: cy - d,
			p3x: x + w, p3y: cy
		};
	};

	function cubic(a, b, c, d, t)
	{
		var m = 1 - t;

		return m * m * m * a + 3 * m * m * t * b + 3 * m * t * t * c + t * t * t * d;
	};

	function cubicDeriv(a, b, c, d, t)
	{
		var m = 1 - t;

		return 3 * m * m * (b - a) + 6 * m * t * (c - b) + 3 * t * t * (d - c);
	};

	/**
	 * Centre line point and unit normal at t. The normal is what the tube is
	 * offset along, so the walls stay the same distance apart through the bend
	 * instead of pinching where the curve is tightest.
	 */
	function tunnelFrame(g, t)
	{
		var px = cubic(g.p0x, g.c1x, g.c2x, g.p3x, t);
		var py = cubic(g.p0y, g.c1y, g.c2y, g.p3y, t);
		var dx = cubicDeriv(g.p0x, g.c1x, g.c2x, g.p3x, t);
		var dy = cubicDeriv(g.p0y, g.c1y, g.c2y, g.p3y, t);
		var len = Math.sqrt(dx * dx + dy * dy);

		if (len < 1e-9)
		{
			dx = 1; dy = 0; len = 1;
		}

		return {x: px, y: py, nx: -dy / len, ny: dx / len};
	};

	/**
	 * A point on one end opening. The ellipse is the tube's circular mouth
	 * projected: full radius across the tube, foreshortened along it, so it
	 * stays square to the tunnel wherever the bow has tilted that end.
	 */
	function tunnelEllipsePoint(f, r, a)
	{
		// n is across the tube; (n.y, -n.x) is the unit tangent along it.
		return [f.x + f.nx * r * Math.cos(a) + f.ny * r * TUNNEL_DEPTH * Math.sin(a),
			f.y + f.ny * r * Math.cos(a) - f.nx * r * TUNNEL_DEPTH * Math.sin(a)];
	};

	function tunnelEllipseTangent(f, r, a)
	{
		return [-f.nx * r * Math.sin(a) + f.ny * r * TUNNEL_DEPTH * Math.cos(a),
			-f.ny * r * Math.sin(a) - f.nx * r * TUNNEL_DEPTH * Math.cos(a)];
	};

	/**
	 * Emits the opening from a0 to a1 as quadrant cubics, continuing from the
	 * current point. Runs either way round, since arcHandle carries the sign
	 * of the sweep, which is what lets the outline trace one end forwards and
	 * the other backwards.
	 */
	function tunnelEllipseArc(c, f, r, a0, a1)
	{
		var steps = Math.max(1, Math.round(Math.abs(a1 - a0) / (Math.PI / 2)));
		var step = (a1 - a0) / steps;
		var k = arcHandle(step);

		for (var i = 0; i < steps; i++)
		{
			var a = a0 + step * i;
			var b = a + step;
			var pa = tunnelEllipsePoint(f, r, a);
			var ta = tunnelEllipseTangent(f, r, a);
			var pb = tunnelEllipsePoint(f, r, b);
			var tb = tunnelEllipseTangent(f, r, b);

			c.curveTo(pa[0] + ta[0] * k, pa[1] + ta[1] * k,
				pb[0] - tb[0] * k, pb[1] - tb[1] * k, pb[0], pb[1]);
		}
	};

	mxShapeOliabakTunnel.prototype.paintVertexShape = function(c, x, y, w, h)
	{
		if (!(w > 0) || !(h > 0))
		{
			return;
		}

		var g = this.getTunnelGeometry(this.style, x, y, w, h);
		var r = g.thick / 2;
		var shading = Math.max(0, Math.min(1,
			mxUtils.getValue(this.style, 'tunnelShading', 0.6)));
		var ends = mxUtils.getValue(this.style, 'tunnelEnds', '1') != '0';

		var upper = [], lower = [];

		for (var i = 0; i <= TUNNEL_STEPS; i++)
		{
			var f = tunnelFrame(g, i / TUNNEL_STEPS);
			upper.push([f.x + f.nx * r, f.y + f.ny * r]);
			lower.push([f.x - f.nx * r, f.y - f.ny * r]);
		}

		var f0 = tunnelFrame(g, 0);
		var f1 = tunnelFrame(g, 1);

		var fill = mxUtils.getValue(this.style,
			mxConstants.STYLE_FILLCOLOR, this.fill);

		if (shading > 0 && fill != null && fill != mxConstants.NONE &&
			mxUtils.getValue(this.style, mxConstants.STYLE_GRADIENTCOLOR) == null)
		{
			// Across the tube rather than along it, which is what turns a flat
			// band into a round surface. A single linear gradient is an
			// approximation once the tunnel bows, but it holds at the
			// curvatures this shape allows, and it costs one fill instead of
			// the three an opaque shape could have used. That matters because
			// the default style is half transparent and stacked fills would
			// read as darker patches where they overlapped.
			c.setGradient(shade(fill, 0.5 * shading), shade(fill, -0.34 * shading),
				x, y, w, h, mxConstants.DIRECTION_SOUTH, 1, 1);
		}

		// One filled layer. The silhouette bulges out around the far half of
		// each opening rather than stopping at a flat chord, which is what the
		// outer edge of a real tube's mouth does. Without it the ellipse
		// stroke encloses a sliver of bare background at each end.
		c.begin();
		c.moveTo(upper[0][0], upper[0][1]);

		for (var i = 1; i <= TUNNEL_STEPS; i++)
		{
			c.lineTo(upper[i][0], upper[i][1]);
		}

		if (ends)
		{
			tunnelEllipseArc(c, f1, r, 0, Math.PI);
		}
		else
		{
			c.lineTo(lower[TUNNEL_STEPS][0], lower[TUNNEL_STEPS][1]);
		}

		for (var i = TUNNEL_STEPS - 1; i >= 0; i--)
		{
			c.lineTo(lower[i][0], lower[i][1]);
		}

		if (ends)
		{
			tunnelEllipseArc(c, f0, r, Math.PI, 2 * Math.PI);
		}

		c.close();
		c.fill();

		c.setStrokeColor(mxUtils.getValue(this.style,
			mxConstants.STYLE_STROKECOLOR, this.stroke));

		if (ends)
		{
			// Full ellipses, stroked and not filled, so both ends read as
			// openings you can see through and the fill alpha still lands
			// exactly once across the whole shape.
			this.paintOpening(c, f0, r);
			this.paintOpening(c, f1, r);
		}
		else
		{
			c.begin();
			c.moveTo(upper[0][0], upper[0][1]);
			c.lineTo(lower[0][0], lower[0][1]);
			c.moveTo(upper[TUNNEL_STEPS][0], upper[TUNNEL_STEPS][1]);
			c.lineTo(lower[TUNNEL_STEPS][0], lower[TUNNEL_STEPS][1]);
			c.stroke();
		}

		// The walls are stroked as two open paths rather than as the outline
		// of the filled shape, so no chord is drawn across either opening.
		var wall = function(pts)
		{
			c.begin();
			c.moveTo(pts[0][0], pts[0][1]);

			for (var i = 1; i < pts.length; i++)
			{
				c.lineTo(pts[i][0], pts[i][1]);
			}

			c.stroke();
		};

		wall(upper);
		wall(lower);
	};

	mxShapeOliabakTunnel.prototype.paintOpening = function(c, f, r)
	{
		c.begin();

		var p = tunnelEllipsePoint(f, r, 0);
		c.moveTo(p[0], p[1]);
		tunnelEllipseArc(c, f, r, 0, 2 * Math.PI);
		c.close();
		c.stroke();
	};

	/**
	 * The two mouths, plus the top and bottom of the tube at its midpoint.
	 * Computed rather than declared because the midpoints move with the bow.
	 */
	mxShapeOliabakTunnel.prototype.getConstraints = function(style, w, h)
	{
		if (!(w > 0) || !(h > 0))
		{
			return [];
		}

		var g = this.getTunnelGeometry(style, 0, 0, w, h);
		var mid = (g.cy - g.apex) / h;
		var r = g.thick / 2 / h;

		return [
			new mxConnectionConstraint(new mxPoint(0, 0.5), false),
			new mxConnectionConstraint(new mxPoint(1, 0.5), false),
			new mxConnectionConstraint(new mxPoint(0.5, mid - r), false),
			new mxConnectionConstraint(new mxPoint(0.5, mid + r), false)
		];
	};

	mxCellRenderer.registerShape('mxgraph.oliabak.tunnel', mxShapeOliabakTunnel);

	// Compatibility alias. curvedPipe was this shape's name for a few hours
	// before it was reworked into a tunnel, and diagrams drawn in that window
	// should still open rather than showing an unknown-shape box.
	mxCellRenderer.registerShape('mxgraph.oliabak.curvedPipe', mxShapeOliabakTunnel);

	// ---------------------------------------------------------------------
	// Arc chevron
	// ---------------------------------------------------------------------

	/**
	 * One slice of a ring, with a chevron head and a matching notch cut into
	 * the tail, so consecutive slices interlock the way the stages of a cycle
	 * diagram do.
	 *
	 * The circle is derived from the cell bounds rather than from the slice,
	 * so every stage of a ring is the same cell geometry and differs only in
	 * startAngle. Dropping six of them on the same spot gives a closed ring
	 * with no arithmetic, which is what makes the stage-count presets possible.
	 *
	 * The label is drawn along the slice's own mid-radius arc through an SVG
	 * textPath, the technique grapheditor/Shapes.js uses for curvedText. The
	 * style therefore carries noLabel=1: the cell's ordinary label would
	 * otherwise be painted flat on top of the curved one.
	 */
	function mxShapeOliabakArcChevron(bounds, fill, stroke, strokewidth)
	{
		mxShape.call(this);
		this.bounds = bounds;
		this.fill = fill;
		this.stroke = stroke;
		this.strokewidth = (strokewidth != null) ? strokewidth : 1;
	};

	mxUtils.extend(mxShapeOliabakArcChevron, mxShape);

	mxShapeOliabakArcChevron.prototype.customProperties = [
		{name: 'startAngle', dispName: 'Start Angle', type: 'float', min: -360,
			max: 360, defVal: -90},
		{name: 'sweep', dispName: 'Sweep', type: 'float', min: 2, max: 355,
			defVal: 55},
		{name: 'ringWidth', dispName: 'Ring Width', type: 'float', min: 0.05,
			max: 0.95, defVal: 0.34},
		{name: 'notch', dispName: 'Chevron Depth', type: 'float', min: -45,
			max: 45, defVal: 11},
		{name: 'labelPos', dispName: 'Label Radius', type: 'float', min: 0,
			max: 1, defVal: 0.5},
		{name: 'labelFlip', dispName: 'Label Direction', type: 'enum',
			defVal: 'auto', enumList: [{val: 'auto', dispName: 'Automatic'},
				{val: 'normal', dispName: 'Along Arc'},
				{val: 'reversed', dispName: 'Reversed'}]}
	];

	mxShapeOliabakArcChevron.prototype.getArcGeometry = function(style, x, y, w, h)
	{
		var sweep = Math.max(2, Math.min(355, mxUtils.getValue(style, 'sweep', 55)));
		var rw = Math.max(0.05, Math.min(0.95,
			mxUtils.getValue(style, 'ringWidth', 0.34)));
		var a0 = mxUtils.getValue(style, 'startAngle', -90) * Math.PI / 180;
		var notch = Math.max(-45, Math.min(45,
			mxUtils.getValue(style, 'notch', 11))) * Math.PI / 180;

		var ro = Math.min(w, h) / 2;

		return {
			cx: x + w / 2, cy: y + h / 2,
			ro: ro, ri: ro * (1 - rw),
			a0: a0, a1: a0 + sweep * Math.PI / 180,
			notch: notch
		};
	};

	/**
	 * The slice outline as a path description: an outer arc, the chevron head,
	 * an inner arc back, then the tail notch. Returned rather than drawn so
	 * the same geometry can measure the box the slice occupies.
	 */
	function arcChevronOutline(g)
	{
		var rm = (g.ri + g.ro) / 2;
		var pts = [];

		function P(r, a)
		{
			return [g.cx + Math.cos(a) * r, g.cy + Math.sin(a) * r];
		};

		function sample(r, from, to)
		{
			var steps = Math.max(2, Math.ceil(Math.abs(to - from) / (Math.PI / 24)));

			for (var i = 0; i <= steps; i++)
			{
				pts.push(P(r, from + (to - from) * i / steps));
			}
		};

		sample(g.ro, g.a0, g.a1);
		pts.push(P(rm, g.a1 + g.notch));
		pts.push(P(g.ri, g.a1));
		sample(g.ri, g.a1, g.a0);
		pts.push(P(rm, g.a0 + g.notch));

		return {pts: pts, rm: rm, P: P};
	};

	mxShapeOliabakArcChevron.prototype.paintVertexShape = function(c, x, y, w, h)
	{
		if (!(w > 0) || !(h > 0))
		{
			return;
		}

		var r = figureRectFor(this, x, y, w, h);
		var g = this.getArcGeometry(this.style, r.x, r.y, r.w, r.h);
		var o = arcChevronOutline(g);
		var rm = o.rm, P = o.P;

		function emitArc(rr, from, to)
		{
			var segs = arcCurves(rr, from, to);

			for (var i = 0; i < segs.length; i++)
			{
				var t = segs[i];
				c.curveTo(g.cx + t[0], g.cy + t[1], g.cx + t[2], g.cy + t[3],
					g.cx + t[4], g.cy + t[5]);
			}
		};

		// Outer wall, chevron head, inner wall back, then the tail notch. Head
		// and tail carry the same angular offset, which is what makes the head
		// of one slice sit exactly inside the tail of the next.
		var p = P(g.ro, g.a0);
		c.begin();
		c.moveTo(p[0], p[1]);
		emitArc(g.ro, g.a0, g.a1);
		p = P(rm, g.a1 + g.notch);
		c.lineTo(p[0], p[1]);
		p = P(g.ri, g.a1);
		c.lineTo(p[0], p[1]);
		emitArc(g.ri, g.a1, g.a0);
		p = P(rm, g.a0 + g.notch);
		c.lineTo(p[0], p[1]);
		c.close();
		c.fillAndStroke();

		this.paintArcLabel(c, r.x, r.y, r.w, r.h);
	};

	/**
	 * Renders the label along the slice's own arc. Writes SVG directly rather
	 * than going through the canvas, so the group it creates has to be
	 * released on every repaint and in destroy.
	 */
	mxShapeOliabakArcChevron.prototype.paintArcLabel = function(c, x, y, w, h)
	{
		this.releaseLabel();

		if (this.state == null || c.root == null ||
			typeof c.createElement !== 'function')
		{
			return;
		}

		var graph = this.state.view.graph;

		// The cell editor shows the raw string, so the curved copy would
		// double up behind it.
		if (graph.cellEditor != null &&
			graph.cellEditor.editingCell == this.state.cell)
		{
			return;
		}

		var label = graph.convertValueToString(this.state.cell);

		if (label == null || label.length == 0)
		{
			return;
		}

		var g = this.getArcGeometry(this.style, x, y, w, h);
		var t = Math.max(0, Math.min(1, mxUtils.getValue(this.style, 'labelPos', 0.5)));
		var r = g.ri + (g.ro - g.ri) * t;
		var flip = mxUtils.getValue(this.style, 'labelFlip', 'auto');
		var a0 = g.a0, a1 = g.a1;

		if (flip == 'reversed' || (flip == 'auto' &&
			Math.sin((a0 + a1) / 2) > 0))
		{
			// The slice faces downwards, where text laid along the arc would
			// come out upside down. Running the path the other way puts it the
			// right way up on the inside of the arc instead.
			a0 = g.a1;
			a1 = g.a0;
		}

		var s = c.state;
		var sc = s.scale;
		var cx = (g.cx + s.dx) * sc;
		var cy = (g.cy + s.dy) * sc;
		var rr = r * sc;
		var x0 = cx + Math.cos(a0) * rr, y0 = cy + Math.sin(a0) * rr;
		var x1 = cx + Math.cos(a1) * rr, y1 = cy + Math.sin(a1) * rr;
		var span = Math.abs(a1 - a0);
		var large = (span > Math.PI) ? 1 : 0;
		var sweepFlag = (a1 > a0) ? 1 : 0;

		var d = 'M ' + c.format(x0) + ' ' + c.format(y0) + ' A ' + c.format(rr) +
			' ' + c.format(rr) + ' 0 ' + large + ' ' + sweepFlag + ' ' +
			c.format(x1) + ' ' + c.format(y1);

		var pathId = (c.idPrefix || '') + 'oac-' + mxObjectIdentity.get(this);
		var useBaseUrl = !mxClient.IS_CHROMEAPP && c.root.ownerDocument == document;
		var href = (useBaseUrl ? c.getBaseUrl().replace(/([\(\)])/g, '\\$1') : '') +
			'#' + pathId;

		var group = c.createElement('g');

		if (s.transform != null && s.transform.length > 0)
		{
			group.setAttribute('transform', s.transform);
		}

		if (s.alpha < 1)
		{
			group.setAttribute('opacity', s.alpha);
		}

		var defs = c.createElement('defs');
		var path = c.createElement('path');
		path.setAttribute('id', pathId);
		path.setAttribute('d', d);
		defs.appendChild(path);
		group.appendChild(defs);

		var text = c.createElement('text');
		var fontStyle = mxUtils.getValue(this.style, mxConstants.STYLE_FONTSTYLE, 0);

		text.setAttribute('font-size', (mxUtils.getValue(this.style,
			mxConstants.STYLE_FONTSIZE, mxConstants.DEFAULT_FONTSIZE) * sc) + 'px');
		text.setAttribute('font-family', mxUtils.parseCssFontFamily(mxUtils.getValue(
			this.style, mxConstants.STYLE_FONTFAMILY, mxConstants.DEFAULT_FONTFAMILY)));
		text.setAttribute('fill', mxUtils.getValue(this.style,
			mxConstants.STYLE_FONTCOLOR, '#000000'));
		text.setAttribute('text-anchor', 'middle');
		text.setAttribute('dominant-baseline', 'central');

		if ((fontStyle & mxConstants.FONT_BOLD) == mxConstants.FONT_BOLD)
		{
			text.setAttribute('font-weight', 'bold');
		}

		if ((fontStyle & mxConstants.FONT_ITALIC) == mxConstants.FONT_ITALIC)
		{
			text.setAttribute('font-style', 'italic');
		}

		var textPath = c.createElement('textPath');
		textPath.setAttribute('startOffset', '50%');
		textPath.setAttribute('href', href);

		if (useBaseUrl)
		{
			textPath.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', href);
		}

		mxUtils.write(textPath, label);
		text.appendChild(textPath);
		group.appendChild(text);
		c.root.appendChild(group);
		this._arcLabelGroup = group;
	};

	mxShapeOliabakArcChevron.prototype.releaseLabel = function()
	{
		if (this._arcLabelGroup != null && this._arcLabelGroup.parentNode != null)
		{
			this._arcLabelGroup.parentNode.removeChild(this._arcLabelGroup);
		}

		this._arcLabelGroup = null;
	};

	mxShapeOliabakArcChevron.prototype.destroy = function()
	{
		this.releaseLabel();
		mxShape.prototype.destroy.apply(this, arguments);
	};

	/**
	 * Midpoints of the outer wall, the inner wall and the two ends, so a
	 * callout can be attached to a stage.
	 */
	mxShapeOliabakArcChevron.prototype.getConstraints = function(style, w, h)
	{
		if (!(w > 0) || !(h > 0))
		{
			return [];
		}

		var g = this.getArcGeometry(style, 0, 0, w, h);
		var am = (g.a0 + g.a1) / 2;
		var rm = (g.ri + g.ro) / 2;
		var out = [];

		function add(r, a)
		{
			out.push(new mxConnectionConstraint(new mxPoint(
				(g.cx + Math.cos(a) * r) / w, (g.cy + Math.sin(a) * r) / h), false));
		};

		add(g.ro, am);
		add(g.ri, am);
		add(rm, g.a0 + g.notch);
		add(rm, g.a1 + g.notch);

		return out;
	};

	mxCellRenderer.registerShape('mxgraph.oliabak.arcChevron',
		mxShapeOliabakArcChevron);

	// ---------------------------------------------------------------------
	// Infinity loop
	// ---------------------------------------------------------------------

	/**
	 * A DevOps figure eight: two circles joined by their two internal
	 * tangents, cut into chevron stages.
	 *
	 * The construction matters. Two equal circles have exactly two internal
	 * tangents, and those tangents cross each other at the midpoint between
	 * the centres. Because each tangent is given a whole stage of its own, the
	 * crossing lands in the middle of a stage rather than on a joint, which is
	 * how the mark is actually drawn: release passes over plan at the centre
	 * of both bands, not where they end.
	 *
	 * A lemniscate, which this used to be, cannot do that. Its self
	 * intersection is one point on one curve, so the two bands meet there
	 * instead of crossing through one another.
	 *
	 * Stage order runs diagonal, first lobe, diagonal, second lobe, so on the
	 * usual eight-stage list plan and release are the two diagonals and the
	 * colour split falls between test and release.
	 *
	 * The whole loop is one cell, because the stage count is meant to be a
	 * Format panel field and a style property cannot add or remove cells. The
	 * labels therefore come from the cell value, split on commas.
	 */
	function mxShapeOliabakInfinity(bounds, fill, stroke, strokewidth)
	{
		mxShape.call(this);
		this.bounds = bounds;
		this.fill = fill;
		this.stroke = stroke;
		this.strokewidth = (strokewidth != null) ? strokewidth : 1;
	};

	mxUtils.extend(mxShapeOliabakInfinity, mxShape);

	// Six is the floor: two arc stages per lobe either side of the two
	// diagonals. Below that a lobe carries a single stage and stops reading
	// as a cycle.
	mxShapeOliabakInfinity.prototype.customProperties = [
		{name: 'stages', dispName: 'Stages', type: 'int', min: 6, max: 24,
			defVal: 8},
		{name: 'bandWidth', dispName: 'Band Width', type: 'float', min: 0.06,
			max: 0.6, defVal: 0.3},
		{name: 'lobeGap', dispName: 'Lobe Spacing', type: 'float', min: 1.15,
			max: 3, defVal: 1.6},
		{name: 'notch', dispName: 'Chevron Depth', type: 'float', min: 0,
			max: 2.5, defVal: 0.85},
		{name: 'fillColor2', dispName: 'Second Half', type: 'color',
			defVal: '#22C55E'},
		{name: 'labelGap', dispName: 'Label Inset', type: 'float', min: 0,
			max: 0.45, defVal: 0.12}
	];

	var INFINITY_STEPS = 14;

	/**
	 * Circles of radius 1 centred at plus and minus 'gap', with the geometry
	 * of their internal tangents and a stage boundary table measured in arc
	 * length along the loop. Working in arc length rather than in an angle
	 * keeps the chevrons evenly proportioned where the straights meet the
	 * curves, and makes the notch offset a plain distance.
	 */
	mxShapeOliabakInfinity.prototype.getLoopGeometry = function(style, x, y, w, h)
	{
		var n = Math.max(6, Math.min(24,
			Math.round(mxUtils.getValue(style, 'stages', 8))));
		var hb = Math.max(0.06, Math.min(0.6,
			mxUtils.getValue(style, 'bandWidth', 0.3)));
		var gap = Math.max(1.15, Math.min(3,
			mxUtils.getValue(style, 'lobeGap', 1.6)));

		// The tangent from the origin touches a circle of radius 1 whose
		// centre is 'gap' away when sin(alpha) = 1 / gap.
		var sa = 1 / gap;
		var ca = Math.sqrt(1 - sa * sa);
		// Major arc: the way round that stays clear of the other circle.
		var arcSweep = Math.PI + 2 * Math.asin(sa);
		var arcLen = arcSweep;
		var tanLen = 2 * gap * ca;

		// Stage layout: one diagonal, the first lobe, the other diagonal, the
		// second lobe. The diagonals always take exactly one stage each, which
		// is what puts the crossing at their midpoints for any stage count.
		var kL = Math.ceil((n - 2) / 2);
		var kR = (n - 2) - kL;
		var bounds = [0, tanLen];

		for (var i = 1; i <= kL; i++)
		{
			bounds.push(tanLen + arcLen * i / kL);
		}

		bounds.push(2 * tanLen + arcLen);

		for (var i = 1; i <= kR; i++)
		{
			bounds.push(2 * tanLen + arcLen + arcLen * i / kR);
		}

		var halfW = gap + 1 + hb;
		var halfH = 1 + hb;

		return {
			n: n, hb: hb, gap: gap, sa: sa, ca: ca,
			arcLen: arcLen, tanLen: tanLen, arcSweep: arcSweep,
			total: 2 * arcLen + 2 * tanLen, bounds: bounds,
			notch: Math.max(0, Math.min(2.5, mxUtils.getValue(style, 'notch', 0.85))),
			cx: x + w / 2, cy: y + h / 2,
			sx: w / (2 * halfW), sy: h / (2 * halfH)
		};
	};

	/**
	 * Point and tangent at arc length s, in the unit space the geometry is
	 * built in, with y running upwards. Wraps, so a notch offset may run past
	 * either end.
	 */
	function loopAt(g, s)
	{
		var t = g.total;
		s = ((s % t) + t) % t;

		var gap = g.gap, sa = g.sa, ca = g.ca;

		// Tangent points, named for the circle and the side they sit on.
		var tr1x = gap * ca * ca, tr1y = gap * ca * sa;
		var tl1x = -tr1x, tl1y = -tr1y;

		if (s < g.tanLen)
		{
			// Diagonal from the right circle down to the left one.
			var f = s / g.tanLen;

			return {x: tr1x + (tl1x - tr1x) * f, y: tr1y + (tl1y - tr1y) * f,
				dx: -ca, dy: -sa};
		}

		s -= g.tanLen;

		if (s < g.arcLen)
		{
			// Left lobe, the long way round, so it clears the other circle.
			var th = Math.atan2(-ca, sa) - g.arcSweep * (s / g.arcLen);

			return {x: -gap + Math.cos(th), y: Math.sin(th),
				dx: Math.sin(th), dy: -Math.cos(th)};
		}

		s -= g.arcLen;

		if (s < g.tanLen)
		{
			// Diagonal back up from the left circle to the right one.
			var f = s / g.tanLen;
			var tl2x = -gap * ca * ca, tl2y = gap * ca * sa;
			var tr2x = gap * ca * ca, tr2y = -gap * ca * sa;

			return {x: tl2x + (tr2x - tl2x) * f, y: tl2y + (tr2y - tl2y) * f,
				dx: ca, dy: -sa};
		}

		s -= g.arcLen + g.tanLen - g.arcLen;
		var th2 = Math.atan2(-ca, -sa) + g.arcSweep * (s / g.arcLen);

		return {x: gap + Math.cos(th2), y: Math.sin(th2),
			dx: -Math.sin(th2), dy: Math.cos(th2)};
	};

	/**
	 * Maps a unit-space sample to the cell, and returns the screen-space unit
	 * normal. The normal has to be worked out after the scaling, not before,
	 * or a non-square cell would leave the band wider on one axis than the
	 * other.
	 */
	function loopFrame(g, s)
	{
		var p = loopAt(g, s);
		var px = g.cx + p.x * g.sx;
		// Unit space has y upwards and is mapped without a flip, which is
		// what puts the first lobe's stages top, left, bottom, the order the
		// mark is read in: code over build over test.
		var py = g.cy + p.y * g.sy;
		var dx = p.dx * g.sx;
		var dy = p.dy * g.sy;
		var len = Math.sqrt(dx * dx + dy * dy);

		if (len < 1e-9)
		{
			dx = 1; dy = 0; len = 1;
		}

		return {x: px, y: py, nx: -dy / len, ny: dx / len};
	};

	function loopPoint(g, s)
	{
		var p = loopAt(g, s);

		return [g.cx + p.x * g.sx, g.cy + p.y * g.sy];
	};

	/**
	 * The loop itself is a container and paints nothing. Its stages are part
	 * children, one per stage, so each label is a real cell value that a
	 * double click edits in place, and a single stage can be recoloured by
	 * alt-clicking it. The Stages field on this cell adds and removes those
	 * children through the sync listener below.
	 */
	mxShapeOliabakInfinity.prototype.paintVertexShape = function(c, x, y, w, h)
	{
		installLoopSync(this);
		scheduleNormalise(this);
	};

	mxCellRenderer.registerShape('mxgraph.oliabak.infinity', mxShapeOliabakInfinity);

	/**
	 * Style of the loop this cell belongs to: its parent's when it is a part
	 * of one, otherwise its own, so a segment that has been ungrouped still
	 * draws something sensible.
	 */
	function loopStyleFor(shape)
	{
		// The segment's own style. The container writes its parameters into
		// every child, so a child can be adjusted on its own and still follows
		// a change made on the container; the parent is never read here.
		return shape.style;
	};

	function isLoopCell(graph, cell)
	{
		var st = graph.getCurrentCellStyle(cell);
		var sh = (st != null) ? st[mxConstants.STYLE_SHAPE] : null;

		return sh == 'mxgraph.oliabak.infinity' || sh == 'mxgraph.oliabak.cycle';
	};

	/**
	 * One stage of the loop. Sized to the whole loop, like the arc chevron
	 * is sized to its whole ring, and told which stage it is by loopIndex.
	 */
	function mxShapeOliabakLoopSegment(bounds, fill, stroke, strokewidth)
	{
		mxShape.call(this);
		this.bounds = bounds;
		this.fill = fill;
		this.stroke = stroke;
		this.strokewidth = (strokewidth != null) ? strokewidth : 1;
	};

	mxUtils.extend(mxShapeOliabakLoopSegment, mxShape);

	mxShapeOliabakLoopSegment.prototype.customProperties = [
		{name: 'bandWidth', dispName: 'Band Width', type: 'float', min: 0.06,
			max: 0.6, defVal: 0.3},
		{name: 'notch', dispName: 'Chevron Depth', type: 'float', min: 0,
			max: 2.5, defVal: 0.85},
		{name: 'labelPos', dispName: 'Label Position', type: 'float', min: 0.05,
			max: 0.95, defVal: 0.5}
	];

	/**
	 * The outline of one stage as a point ring, used both to paint it and to
	 * work out the box it actually occupies.
	 */
	function loopSegmentOutline(g, k)
	{
		var notchDist = g.notch * g.hb;
		var hbx = g.hb * Math.min(g.sx, g.sy);
		var sa = g.bounds[k];
		var sb = (k + 1 < g.n) ? g.bounds[k + 1] : g.total;
		var outer = [], inner = [];

		for (var i = 0; i <= INFINITY_STEPS; i++)
		{
			var f = loopFrame(g, sa + (sb - sa) * i / INFINITY_STEPS);
			outer.push([f.x + f.nx * hbx, f.y + f.ny * hbx]);
			inner.push([f.x - f.nx * hbx, f.y - f.ny * hbx]);
		}

		var pts = outer.slice();
		pts.push(loopPoint(g, sb + notchDist));
		pts.push(inner[INFINITY_STEPS]);

		for (var i = INFINITY_STEPS - 1; i >= 0; i--)
		{
			pts.push(inner[i]);
		}

		pts.push(loopPoint(g, sa + notchDist));

		return pts;
	};

	function pointsBBox(pts)
	{
		var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;

		for (var i = 0; i < pts.length; i++)
		{
			x1 = Math.min(x1, pts[i][0]); x2 = Math.max(x2, pts[i][0]);
			y1 = Math.min(y1, pts[i][1]); y2 = Math.max(y2, pts[i][1]);
		}

		return {x: x1, y: y1, width: Math.max(1, x2 - x1), height: Math.max(1, y2 - y1)};
	};

	/**
	 * Fraction of the whole figure that one stage occupies, as
	 * [x, y, width, height] in 0..1. Stored on the stage as segBox so the
	 * stage can be given a cell box that hugs it while still knowing the
	 * figure it belongs to.
	 */
	function loopSegmentFraction(style, k)
	{
		var g = mxShapeOliabakInfinity.prototype.getLoopGeometry(style, 0, 0, 1000, 1000);
		var bb = pointsBBox(loopSegmentOutline(g, k));

		return [bb.x / 1000, bb.y / 1000, bb.width / 1000, bb.height / 1000];
	};

	function arcChevronFraction(style)
	{
		var g = mxShapeOliabakArcChevron.prototype.getArcGeometry(style, 0, 0, 1000, 1000);
		var bb = pointsBBox(arcChevronOutline(g).pts);

		return [bb.x / 1000, bb.y / 1000, bb.width / 1000, bb.height / 1000];
	};

	/**
	 * Rebuilds the whole figure's rectangle from a stage's own bounds.
	 *
	 * A stage's cell box hugs the stage, which is what makes its selection
	 * outline and its resize handles belong to it rather than to the whole
	 * figure. segBox records where that box sits inside the figure, so the
	 * stage can still be drawn in the figure's frame. Moving the stage moves
	 * the frame with it, and resizing the stage scales the frame, so both
	 * gestures affect only that stage.
	 */
	function figureRectFor(shape, x, y, w, h)
	{
		var box = mxUtils.getValue(shape.style, 'segBox', null);

		if (box != null)
		{
			var f = String(box).split(',');

			if (f.length == 4)
			{
				var fx = parseFloat(f[0]), fy = parseFloat(f[1]);
				var fw = parseFloat(f[2]), fh = parseFloat(f[3]);

				if (fw > 0.0001 && fh > 0.0001 && !isNaN(fx) && !isNaN(fy))
				{
					var W = w / fw, H = h / fh;

					return {x: x - fx * W, y: y - fy * H, w: W, h: H};
				}
			}
		}

		// No segBox yet: an older diagram, or a stage that has just been
		// dropped. Fall back to the stage filling the figure, which is what
		// it used to mean, until the normalise pass writes one.
		return {x: x, y: y, w: w, h: h};
	};

	mxShapeOliabakLoopSegment.prototype.paintVertexShape = function(c, x, y, w, h)
	{
		if (!(w > 0) || !(h > 0))
		{
			return;
		}

		var loopStyle = loopStyleFor(this);
		var r = figureRectFor(this, x, y, w, h);
		var g = mxShapeOliabakInfinity.prototype.getLoopGeometry(loopStyle,
			r.x, r.y, r.w, r.h);
		var k = Math.max(0, Math.min(g.n - 1,
			Math.round(mxUtils.getValue(this.style, 'loopIndex', 0))));
		var pts = loopSegmentOutline(g, k);

		c.begin();
		c.moveTo(pts[0][0], pts[0][1]);

		for (var i = 1; i < pts.length; i++)
		{
			c.lineTo(pts[i][0], pts[i][1]);
		}

		c.close();
		c.fillAndStroke();

		this.paintSegmentLabel(c, g, k, loopStyle);
	};

	/**
	 * This stage's own label, along its own stretch of the centre line.
	 */
	mxShapeOliabakLoopSegment.prototype.paintSegmentLabel = function(c, g, k, loopStyle)
	{
		this.releaseLabel();

		if (this.state == null || c.root == null ||
			typeof c.createElement !== 'function')
		{
			return;
		}

		var graph = this.state.view.graph;

		if (graph.cellEditor != null &&
			graph.cellEditor.editingCell == this.state.cell)
		{
			return;
		}

		var text = graph.convertValueToString(this.state.cell);

		if (text == null || text.length == 0)
		{
			return;
		}

		var st = c.state;
		var sc = st.scale;
		var gap = Math.max(0, Math.min(0.45,
			mxUtils.getValue(loopStyle, 'labelGap', 0.12)));
		var s0 = g.bounds[k];
		var s1 = (k + 1 < g.n) ? g.bounds[k + 1] : g.total;
		var a = s0 + (s1 - s0) * gap;
		var b = s1 - (s1 - s0) * gap;
		var pa = loopPoint(g, a), pb = loopPoint(g, b);
		// Right to left stages get the path reversed, which keeps the text
		// upright instead of standing on its head.
		var reversed = pb[0] < pa[0];
		var d = '';

		for (var i = 0; i <= INFINITY_STEPS; i++)
		{
			var f = reversed ? (INFINITY_STEPS - i) / INFINITY_STEPS : i / INFINITY_STEPS;
			var pt = loopPoint(g, a + (b - a) * f);
			d += (i == 0 ? 'M ' : ' L ') + c.format((pt[0] + st.dx) * sc) + ' ' +
				c.format((pt[1] + st.dy) * sc);
		}

		var pathId = (c.idPrefix || '') + 'ols-' + mxObjectIdentity.get(this);
		var useBaseUrl = !mxClient.IS_CHROMEAPP && c.root.ownerDocument == document;
		var href = (useBaseUrl ? c.getBaseUrl().replace(/([\(\)])/g, '\\$1') : '') +
			'#' + pathId;
		var group = c.createElement('g');

		if (st.transform != null && st.transform.length > 0)
		{
			group.setAttribute('transform', st.transform);
		}

		var defs = c.createElement('defs');
		var path = c.createElement('path');
		path.setAttribute('id', pathId);
		path.setAttribute('d', d);
		defs.appendChild(path);
		group.appendChild(defs);

		var fontStyle = mxUtils.getValue(this.style, mxConstants.STYLE_FONTSTYLE, 0);
		var el = c.createElement('text');
		el.setAttribute('font-size', (mxUtils.getValue(this.style,
			mxConstants.STYLE_FONTSIZE, mxConstants.DEFAULT_FONTSIZE) * sc) + 'px');
		el.setAttribute('font-family', mxUtils.parseCssFontFamily(mxUtils.getValue(
			this.style, mxConstants.STYLE_FONTFAMILY, mxConstants.DEFAULT_FONTFAMILY)));
		el.setAttribute('fill', mxUtils.getValue(this.style,
			mxConstants.STYLE_FONTCOLOR, '#FFFFFF'));
		el.setAttribute('text-anchor', 'middle');
		el.setAttribute('dominant-baseline', 'central');

		if ((fontStyle & mxConstants.FONT_BOLD) == mxConstants.FONT_BOLD)
		{
			el.setAttribute('font-weight', 'bold');
		}

		if ((fontStyle & mxConstants.FONT_ITALIC) == mxConstants.FONT_ITALIC)
		{
			el.setAttribute('font-style', 'italic');
		}

		// Stage 0 is the diagonal that passes under the other one, and its
		// midpoint is exactly where the crossing covers it. Its label sits at
		// the near quarter instead, which is where the mark puts PLAN. Any
		// stage can override this with labelPos.
		var pos = Math.max(0.05, Math.min(0.95, mxUtils.getValue(this.style,
			'labelPos', (k == 0) ? 0.24 : 0.5)));

		var tp = c.createElement('textPath');
		tp.setAttribute('startOffset', Math.round(pos * 100) + '%');
		tp.setAttribute('href', href);

		if (useBaseUrl)
		{
			tp.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', href);
		}

		mxUtils.write(tp, text);
		el.appendChild(tp);
		group.appendChild(el);
		c.root.appendChild(group);
		this._segLabelGroup = group;
	};

	mxShapeOliabakLoopSegment.prototype.releaseLabel = function()
	{
		if (this._segLabelGroup != null && this._segLabelGroup.parentNode != null)
		{
			this._segLabelGroup.parentNode.removeChild(this._segLabelGroup);
		}

		this._segLabelGroup = null;
	};

	mxShapeOliabakLoopSegment.prototype.destroy = function()
	{
		this.releaseLabel();
		mxShape.prototype.destroy.apply(this, arguments);
	};

	mxCellRenderer.registerShape('mxgraph.oliabak.loopSegment', mxShapeOliabakLoopSegment);

	// ---------------------------------------------------------------------
	// Cycle ring container
	// ---------------------------------------------------------------------

	/**
	 * The ring equivalent of the loop: a container whose part children are
	 * arc chevrons, with the stage count on the container. The sync listener
	 * hands each child its start angle and sweep.
	 */
	function mxShapeOliabakCycle(bounds, fill, stroke, strokewidth)
	{
		mxShape.call(this);
		this.bounds = bounds;
		this.fill = fill;
		this.stroke = stroke;
		this.strokewidth = (strokewidth != null) ? strokewidth : 1;
	};

	mxUtils.extend(mxShapeOliabakCycle, mxShape);

	mxShapeOliabakCycle.prototype.customProperties = [
		{name: 'stages', dispName: 'Stages', type: 'int', min: 3, max: 24,
			defVal: 5},
		{name: 'ringWidth', dispName: 'Ring Width', type: 'float', min: 0.05,
			max: 0.95, defVal: 0.36},
		{name: 'notch', dispName: 'Chevron Depth', type: 'float', min: -45,
			max: 45, defVal: 11},
		{name: 'startAngle', dispName: 'Start Angle', type: 'float', min: -360,
			max: 360, defVal: -90}
	];

	mxShapeOliabakCycle.prototype.paintVertexShape = function(c, x, y, w, h)
	{
		installLoopSync(this);
		scheduleNormalise(this);
	};

	mxCellRenderer.registerShape('mxgraph.oliabak.cycle', mxShapeOliabakCycle);

	// ---------------------------------------------------------------------
	// Stage count sync
	// ---------------------------------------------------------------------

	// Colours handed to stages the sync has to create. Contrasting enough to
	// read as separate steps; the user recolours from there.
	var STAGE_WHEEL = ['#1F6F8B', '#2E9E83', '#7BA23F', '#E2A32D',
		'#D96C3B', '#B5485D', '#7A5AA8', '#4A7FB5'];

	function loopChildren(graph, parent, childShape)
	{
		var model = graph.getModel();
		var kids = [];

		for (var i = 0; i < model.getChildCount(parent); i++)
		{
			var ch = model.getChildAt(parent, i);
			var cst = graph.getCurrentCellStyle(ch);

			if (cst != null && cst[mxConstants.STYLE_SHAPE] == childShape)
			{
				kids.push(ch);
			}
		}

		return kids;
	};

	function loopKind(graph, parent)
	{
		var pst = graph.getCurrentCellStyle(parent);
		var isRing = (pst[mxConstants.STYLE_SHAPE] == 'mxgraph.oliabak.cycle');

		return {
			style: pst, isRing: isRing,
			childShape: isRing ? 'mxgraph.oliabak.arcChevron' : 'mxgraph.oliabak.loopSegment',
			n: isRing ?
				Math.max(3, Math.min(24, Math.round(mxUtils.getValue(pst, 'stages', 5)))) :
				Math.max(6, Math.min(24, Math.round(mxUtils.getValue(pst, 'stages', 8))))
		};
	};

	/**
	 * Writes the container's parameters into one child's style. For a ring
	 * that is the child's slice of the circle; for a loop it is a copy of the
	 * loop parameters, so a segment that gets ungrouped still knows what loop
	 * it came from. Geometry is not touched here.
	 */
	function stageStyle(kind, st, k, n)
	{
		var pst = kind.style;

		if (kind.isRing)
		{
			var step = 360 / n;
			var a0 = mxUtils.getValue(pst, 'startAngle', -90) + k * step;
			st = mxUtils.setStyle(st, 'startAngle', Math.round(a0 * 100) / 100);
			st = mxUtils.setStyle(st, 'sweep', Math.round(step * 100) / 100);
			st = mxUtils.setStyle(st, 'notch', mxUtils.getValue(pst, 'notch', 11));
			st = mxUtils.setStyle(st, 'ringWidth', mxUtils.getValue(pst, 'ringWidth', 0.36));
		}
		else
		{
			st = mxUtils.setStyle(st, 'loopIndex', k);
			st = mxUtils.setStyle(st, 'stages', n);
			st = mxUtils.setStyle(st, 'bandWidth', mxUtils.getValue(pst, 'bandWidth', 0.3));
			st = mxUtils.setStyle(st, 'lobeGap', mxUtils.getValue(pst, 'lobeGap', 1.6));
			st = mxUtils.setStyle(st, 'notch', mxUtils.getValue(pst, 'notch', 0.85));
		}

		return st;
	};

	/**
	 * The stage's fractional box within the figure, and the cell box that
	 * hugs it. Computed from the style the stage will actually have, so the
	 * two always agree.
	 */
	function styleMap(st)
	{
		var out = {};
		var parts = String(st).split(';');

		for (var i = 0; i < parts.length; i++)
		{
			var eq = parts[i].indexOf('=');

			if (eq > 0)
			{
				out[parts[i].substring(0, eq)] = parts[i].substring(eq + 1);
			}
		}

		return out;
	};

	function stageBox(kind, st, k, n, geo)
	{
		var f = kind.isRing ? arcChevronFraction(styleMap(st)) :
			loopSegmentFraction(styleMap(st), k);

		return {
			frac: f,
			rect: new mxGeometry(f[0] * geo.width, f[1] * geo.height,
				Math.max(1, f[2] * geo.width), Math.max(1, f[3] * geo.height))
		};
	};

	/**
	 * A stage count change, or a stage added or removed by hand. Adds or
	 * drops children to match, re-indexes every stage and puts each one back
	 * on the figure. Labels and colours survive; positions do not, which is
	 * what changing the count means in every SmartArt tool: the figure is
	 * laid out again.
	 *
	 * The stages are ordinary cells on purpose. They can be moved, resized,
	 * recoloured and deleted one at a time, and nothing here runs for any of
	 * that. Only the container's own style, and the set of its children,
	 * reach this function.
	 */
	function reflowLoop(graph, parent, forceN)
	{
		var model = graph.getModel();
		var kind = loopKind(graph, parent);
		var geo = model.getGeometry(parent);

		if (geo == null)
		{
			return;
		}

		var kids = loopChildren(graph, parent, kind.childShape);
		// forceN wins over the style, so a reflow triggered inside the same
		// model edit that set the count is not tripped by a stale style cache.
		var n = (forceN != null) ? forceN : kind.n;

		while (kids.length > n)
		{
			model.remove(kids.pop());
		}

		var half = Math.round(n / 2);

		while (kids.length < n)
		{
			var k = kids.length;
			var colour = kind.isRing ? STAGE_WHEEL[k % STAGE_WHEEL.length] :
				((k < half) ? mxUtils.getValue(kind.style, mxConstants.STYLE_FILLCOLOR, '#16324F') :
					mxUtils.getValue(kind.style, 'fillColor2', '#22C55E'));
			var cell = new mxCell(mxResources.get('step') + ' ' + (k + 1),
				new mxGeometry(0, 0, geo.width, geo.height),
				'shape=' + kind.childShape + ';noLabel=1;sketch=0;html=1;pointerEvents=1;' +
				'strokeColor=#FFFFFF;strokeWidth=3;fontColor=#FFFFFF;fontSize=15;' +
				'fontStyle=1;fillColor=' + colour + ';');
			cell.vertex = true;
			model.add(parent, cell);
			kids.push(cell);
		}

		for (var k = 0; k < kids.length; k++)
		{
			var ch = kids[k];
			var st = stageStyle(kind, model.getStyle(ch) || '', k, n);
			var box = stageBox(kind, st, k, n, geo);
			st = mxUtils.setStyle(st, 'segBox', box.frac.map(function(v)
			{
				return Math.round(v * 10000) / 10000;
			}).join(','));

			if (st != model.getStyle(ch))
			{
				model.setStyle(ch, st);
			}

			var cg = model.getGeometry(ch);

			if (cg == null || Math.abs(cg.x - box.rect.x) > 0.01 ||
				Math.abs(cg.y - box.rect.y) > 0.01 ||
				Math.abs(cg.width - box.rect.width) > 0.01 ||
				Math.abs(cg.height - box.rect.height) > 0.01)
			{
				model.setGeometry(ch, box.rect);
			}
		}
	};

	/**
	 * A container parameter other than the count changed: band width, ring
	 * width, chevron depth, start angle. Hands the new values to the children
	 * and leaves where they are alone.
	 */
	function propagateLoop(graph, parent)
	{
		var model = graph.getModel();
		var kind = loopKind(graph, parent);
		var kids = loopChildren(graph, parent, kind.childShape);

		for (var k = 0; k < kids.length; k++)
		{
			var st = stageStyle(kind, model.getStyle(kids[k]) || '', k, kids.length);
			var f = kind.isRing ? arcChevronFraction(styleMap(st)) :
				loopSegmentFraction(styleMap(st), k);
			st = mxUtils.setStyle(st, 'segBox', f.map(function(v)
			{
				return Math.round(v * 10000) / 10000;
			}).join(','));

			if (st != model.getStyle(kids[k]))
			{
				model.setStyle(kids[k], st);
			}
		}
	};

	/**
	 * Gives a figure its stage boxes once, out of the paint cycle.
	 *
	 * A palette preset builds its stages before the group is in the model, so
	 * no child change is ever reported for them and the listener below never
	 * sees them. The same is true of a diagram saved before stages had their
	 * own boxes. Either way the first paint notices a stage without a segBox
	 * and schedules a single reflow, which is a model edit and so must not
	 * run inside paint.
	 */
	function scheduleNormalise(shape)
	{
		if (shape.state == null || shape.__oliabakNormalised)
		{
			return;
		}

		var graph = shape.state.view.graph;
		var cell = shape.state.cell;
		var model = graph.getModel();
		var needs = false;

		for (var i = 0; i < model.getChildCount(cell); i++)
		{
			var st = graph.getCurrentCellStyle(model.getChildAt(cell, i));

			if (st != null && st['segBox'] == null &&
				(st[mxConstants.STYLE_SHAPE] == 'mxgraph.oliabak.loopSegment' ||
				st[mxConstants.STYLE_SHAPE] == 'mxgraph.oliabak.arcChevron'))
			{
				needs = true;
				break;
			}
		}

		shape.__oliabakNormalised = true;

		if (!needs)
		{
			return;
		}

		window.setTimeout(function()
		{
			if (!model.contains(cell))
			{
				return;
			}

			model.beginUpdate();

			try
			{
				reflowLoop(graph, cell, loopKind(graph, cell).n);
			}
			finally
			{
				model.endUpdate();
			}
		}, 0);
	};

	/**
	 * Installed on first paint of any loop container, because shape code may
	 * load after the editor exists. Two triggers only:
	 *
	 *   - the container's own style changed: a count change reflows, any
	 *     other parameter just propagates;
	 *   - a stage was added or removed under it: the Stages field is set to
	 *     the new count, and the figure reflows.
	 *
	 * Moving, resizing, recolouring or relabelling a single stage is none of
	 * this function's business and never reaches it. Re-entrancy is guarded:
	 * the sync itself is a model edit.
	 */
	function installLoopSync(shape)
	{
		if (shape.state == null)
		{
			return;
		}

		var graph = shape.state.view.graph;

		if (graph == null || graph.__oliabakLoopSync || typeof mxStyleChange === 'undefined')
		{
			return;
		}

		graph.__oliabakLoopSync = true;
		var syncing = false;

		graph.getModel().addListener(mxEvent.CHANGE, function(sender, evt)
		{
			if (syncing)
			{
				return;
			}

			var edit = evt.getProperty('edit');
			var changes = (edit != null) ? edit.changes : null;

			if (changes == null)
			{
				return;
			}

			var model = graph.getModel();
			var work = {};

			function note(cell, mode)
			{
				if (cell != null && model.contains(cell) && isLoopCell(graph, cell))
				{
					work[cell.id] = {cell: cell, mode: (work[cell.id] != null &&
						work[cell.id].mode == 'reflow') ? 'reflow' : mode};
				}
			};

			for (var i = 0; i < changes.length; i++)
			{
				var ch = changes[i];

				if (ch instanceof mxStyleChange)
				{
					// The container itself. A different stage count reflows;
					// anything else on it only propagates.
					if (isLoopCell(graph, ch.cell))
					{
						note(ch.cell, 'propagate');
					}
				}
				else if (ch instanceof mxChildChange)
				{
					// A stage came or went. The container that lost or gained it
					// is told to recount.
					note(ch.parent, 'count');
					note(ch.previous, 'count');
				}
			}

			var ids = Object.keys(work);

			if (ids.length == 0)
			{
				return;
			}

			syncing = true;
			model.beginUpdate();

			try
			{
				for (var i = 0; i < ids.length; i++)
				{
					var item = work[ids[i]];
					var kind = loopKind(graph, item.cell);
					var count = loopChildren(graph, item.cell, kind.childShape).length;

					if (item.mode == 'count')
					{
						// Keep the Stages field truthful after a manual delete or
						// paste, then lay the figure out for that exact count.
						var floor = kind.isRing ? 3 : 6;
						var n = Math.max(floor, Math.min(24, count));
						var st = mxUtils.setStyle(model.getStyle(item.cell) || '', 'stages', n);

						if (st != model.getStyle(item.cell))
						{
							model.setStyle(item.cell, st);
						}

						reflowLoop(graph, item.cell, n);
					}
					else if (count != kind.n)
					{
						reflowLoop(graph, item.cell, kind.n);
					}
					else
					{
						propagateLoop(graph, item.cell);
					}
				}
			}
			finally
			{
				model.endUpdate();
				syncing = false;
			}
		});
	};

	// ---------------------------------------------------------------------
	// Parametric devices
	// ---------------------------------------------------------------------

	/**
	 * The classic router, drawn rather than stencilled.
	 *
	 * The Cisco stencil is a fixed set of paths, so its top face keeps a fixed
	 * proportion however the shape is resized: stretch it upwards and the
	 * cylinder turns into a capsule. This draws the same icon from parameters
	 * instead, so the top face has the depth handle a cylinder has.
	 *
	 * 'size' follows draw.io's own cylinder convention exactly: the ellipse
	 * radius in pixels, clamped to half the height, with the handle on the
	 * left edge at y + size. Anyone who has dragged a cylinder already knows
	 * how this behaves.
	 *
	 * The four arrows are the stencil's own polygons, normalised to the lid
	 * ellipse, so they are the icon everyone recognises and they foreshorten
	 * with the top face instead of floating over it.
	 */
	function mxShapeOliabakRouter(bounds, fill, stroke, strokewidth)
	{
		mxShape.call(this);
		this.bounds = bounds;
		this.fill = fill;
		this.stroke = stroke;
		this.strokewidth = (strokewidth != null) ? strokewidth : 1;
	};

	mxUtils.extend(mxShapeOliabakRouter, mxShape);

	mxShapeOliabakRouter.prototype.size = 15;

	mxShapeOliabakRouter.prototype.customProperties = [
		{name: 'size', dispName: 'Top Depth', type: 'float', min: 0, defVal: 15},
		{name: 'strokeColor2', dispName: 'Marking Color', type: 'color',
			defVal: '#CC0000'}
	];

	// The stencil's four arrow polygons, as (u, v) on the lid ellipse where
	// the ellipse is the unit circle. Regenerated from
	// stencils/cisco/routers.xml, shape "Router".
	var ROUTER_ARROWS = [
		[[-0.2297,-0.3792],[-0.1486,-0.0688],[-0.4596,0.104],[-0.3919,-0.0347],
			[-0.865,-0.2416],[-0.7434,-0.4827],[-0.284,-0.2757]],
		[[0.2163,0.3792],[0.1486,0.0688],[0.4324,-0.1029],[0.3919,0.0347],
			[0.8512,0.2416],[0.7434,0.4485],[0.2702,0.2416]],
		[[0.0541,-0.552],[0.3647,-0.7589],[0.3785,-0.4485],[0.2974,-0.4827],
			[0.1486,-0.1381],[-0.0002,-0.2064],[0.1486,-0.5168]],
		[[-0.0813,0.6896],[-0.3785,0.8282],[-0.3919,0.4485],[-0.2974,0.5178],
			[-0.1352,0.1381],[0.0136,0.2074],[-0.1624,0.6213]]
	];

	mxShapeOliabakRouter.prototype.paintVertexShape = function(c, x, y, w, h)
	{
		if (!(w > 0) || !(h > 0))
		{
			return;
		}

		var size = Math.max(0, Math.min(h * 0.5, parseFloat(
			mxUtils.getValue(this.style, 'size', this.size))));

		c.translate(x, y);

		if (size <= 0)
		{
			c.rect(0, 0, w, h);
			c.fillAndStroke();

			return;
		}

		// Body: the lid's front half, down the sides, round the base.
		c.begin();
		c.moveTo(0, size);
		c.arcTo(w * 0.5, size, 0, 0, 1, w * 0.5, 0);
		c.arcTo(w * 0.5, size, 0, 0, 1, w, size);
		c.lineTo(w, h - size);
		c.arcTo(w * 0.5, size, 0, 0, 1, w * 0.5, h);
		c.arcTo(w * 0.5, size, 0, 0, 1, 0, h - size);
		c.close();
		c.fillAndStroke();

		c.setShadow(false);

		// The lid, filled so the arrows sit on a face rather than on the body.
		c.begin();
		c.moveTo(0, size);
		c.arcTo(w * 0.5, size, 0, 0, 1, w * 0.5, 0);
		c.arcTo(w * 0.5, size, 0, 0, 1, w, size);
		c.arcTo(w * 0.5, size, 0, 0, 1, w * 0.5, 2 * size);
		c.arcTo(w * 0.5, size, 0, 0, 1, 0, size);
		c.close();
		c.fillAndStroke();

		this.paintMarkings(c, w * 0.5, size, w * 0.5, size);
	};

	/**
	 * The arrows, mapped from the unit circle onto the lid ellipse.
	 */
	mxShapeOliabakRouter.prototype.paintMarkings = function(c, cx, cy, rx, ry)
	{
		// Filled, not stroked. The stencil does the same: these arrows are
		// only a few pixels thick once foreshortened, and any outline heavy
		// enough to see swamps the shape it is outlining.
		c.setFillColor(mxUtils.getValue(this.style, 'strokeColor2', '#CC0000'));

		for (var i = 0; i < ROUTER_ARROWS.length; i++)
		{
			var poly = ROUTER_ARROWS[i];
			c.begin();
			c.moveTo(cx + poly[0][0] * rx, cy + poly[0][1] * ry);

			for (var k = 1; k < poly.length; k++)
			{
				c.lineTo(cx + poly[k][0] * rx, cy + poly[k][1] * ry);
			}

			c.close();
			c.fill();
		}
	};

	mxCellRenderer.registerShape('mxgraph.oliabak.router', mxShapeOliabakRouter);

	/**
	 * The classic switch: an isometric box with four arrows on its top face.
	 *
	 * Same problem as the router. The stencil's depth is baked into its paths,
	 * so resizing skews the box. Here 'size' is the isometric depth in pixels
	 * and it gets a handle, so the box keeps its shape at any width or height.
	 *
	 * The arrows are the stencil's own polygons expressed in the top face's
	 * own two axes, so they shear with the face rather than sliding across it.
	 */
	function mxShapeOliabakSwitch(bounds, fill, stroke, strokewidth)
	{
		mxShape.call(this);
		this.bounds = bounds;
		this.fill = fill;
		this.stroke = stroke;
		this.strokewidth = (strokewidth != null) ? strokewidth : 1;
	};

	mxUtils.extend(mxShapeOliabakSwitch, mxShape);

	mxShapeOliabakSwitch.prototype.size = 16;

	mxShapeOliabakSwitch.prototype.customProperties = [
		{name: 'size', dispName: 'Depth', type: 'float', min: 0, defVal: 16},
		{name: 'strokeColor2', dispName: 'Marking Color', type: 'color',
			defVal: '#CC0000'}
	];

	// Regenerated from stencils/cisco/switches.xml, "Workgroup Switch", as
	// (s, t) along the top face's front edge and depth edge.
	var SWITCH_ARROWS = [
		[[0.4838,0.2554],[0.4802,0.2126],[0.2354,0.2126],[0.2419,0.1277],
			[0.1376,0.2126],[0.2255,0.3404],[0.2321,0.2554]],
		[[0.5242,0.6386],[0.5291,0.5747],[0.2845,0.5747],[0.2823,0.5109],
			[0.178,0.5958],[0.2746,0.7024],[0.2724,0.6386]],
		[[0.474,0.3831],[0.4779,0.4253],[0.7296,0.4253],[0.7159,0.5109],
			[0.8204,0.4253],[0.7394,0.2976],[0.7257,0.3831]],
		[[0.4514,0.7663],[0.4553,0.8084],[0.7001,0.8084],[0.6933,0.894],
			[0.8066,0.7874],[0.7099,0.6807],[0.7031,0.7663]]
	];

	mxShapeOliabakSwitch.prototype.paintVertexShape = function(c, x, y, w, h)
	{
		if (!(w > 0) || !(h > 0))
		{
			return;
		}

		// Depth cannot eat the whole box, or the front face disappears.
		var d = Math.max(0, Math.min(Math.min(w, h) * 0.7, parseFloat(
			mxUtils.getValue(this.style, 'size', this.size))));

		c.translate(x, y);

		if (d <= 0)
		{
			c.rect(0, 0, w, h);
			c.fillAndStroke();

			return;
		}

		// Front face.
		c.begin();
		c.moveTo(0, d);
		c.lineTo(w - d, d);
		c.lineTo(w - d, h);
		c.lineTo(0, h);
		c.close();
		c.fillAndStroke();

		// Right face.
		c.begin();
		c.moveTo(w - d, d);
		c.lineTo(w, 0);
		c.lineTo(w, h - d);
		c.lineTo(w - d, h);
		c.close();
		c.fillAndStroke();

		// Top face, drawn last so the arrows sit on it.
		c.begin();
		c.moveTo(0, d);
		c.lineTo(d, 0);
		c.lineTo(w, 0);
		c.lineTo(w - d, d);
		c.close();
		c.fillAndStroke();

		c.setShadow(false);
		this.paintMarkings(c, w, d);
	};

	mxShapeOliabakSwitch.prototype.paintMarkings = function(c, w, d)
	{
		// The top face in its own axes: origin at the front-left corner, one
		// axis along the front edge, the other back along the depth.
		var ox = 0, oy = d;
		var ux = w - d, uy = 0;
		var vx = d, vy = -d;

		// Filled, not stroked, as the stencil does.
		c.setFillColor(mxUtils.getValue(this.style, 'strokeColor2', '#CC0000'));

		for (var i = 0; i < SWITCH_ARROWS.length; i++)
		{
			var poly = SWITCH_ARROWS[i];
			c.begin();
			c.moveTo(ox + poly[0][0] * ux + poly[0][1] * vx,
				oy + poly[0][0] * uy + poly[0][1] * vy);

			for (var k = 1; k < poly.length; k++)
			{
				c.lineTo(ox + poly[k][0] * ux + poly[k][1] * vx,
					oy + poly[k][0] * uy + poly[k][1] * vy);
			}

			c.close();
			c.fill();
		}
	};

	mxCellRenderer.registerShape('mxgraph.oliabak.switch', mxShapeOliabakSwitch);

	// ---------------------------------------------------------------------
	// Handles
	// ---------------------------------------------------------------------

	// Graph.handleFactory is populated in grapheditor/Shapes.js, which always
	// loads before this file (the app bundle precedes shapes-14-6-5.min.js,
	// and in ?dev=1 this file is fetched on demand once a shape is used). It
	// is absent in embed mode, where custom handles are stubbed out.
	if (typeof Graph !== 'undefined' && Graph.handleFactory != null &&
		typeof Graph.createHandle === 'function')
	{
		/**
		 * Builds a handle sitting at fraction t along the chord, offset by the
		 * style key's percentage. Dragging it writes the perpendicular
		 * distance back as a percentage of the chord.
		 */
		function bowHandle(state, key, t, defVal)
		{
			return Graph.createHandle(state, [key], function(bounds)
			{
				var pts = state.absolutePoints;

				if (pts == null || pts.length < 2 ||
					pts[0] == null || pts[pts.length - 1] == null)
				{
					return null;
				}

				var s = state.view.scale;
				var tr = state.view.translate;
				var p0 = pts[0];
				var p1 = pts[pts.length - 1];
				var dx = p1.x - p0.x;
				var dy = p1.y - p0.y;
				var len = Math.sqrt(dx * dx + dy * dy);

				if (len < 1)
				{
					return null;
				}

				var ux = dx / len, uy = dy / len;
				var b = mxUtils.getValue(state.style, key, defVal) / 100 * len;

				return new mxPoint(
					(p0.x + ux * len * t - uy * b) / s - tr.x,
					(p0.y + uy * len * t + ux * b) / s - tr.y);
			}, function(bounds, pt)
			{
				var pts = state.absolutePoints;

				if (pts == null || pts.length < 2 ||
					pts[0] == null || pts[pts.length - 1] == null)
				{
					return;
				}

				var s = state.view.scale;
				var tr = state.view.translate;
				var p0 = pts[0];
				var p1 = pts[pts.length - 1];
				var dx = p1.x - p0.x;
				var dy = p1.y - p0.y;
				var len = Math.sqrt(dx * dx + dy * dy);

				if (len < 1)
				{
					return;
				}

				var ux = dx / len, uy = dy / len;
				var px = (pt.x + tr.x) * s - p0.x;
				var py = (pt.y + tr.y) * s - p0.y;
				// Signed distance along the left-hand normal (-uy, ux).
				var bow = Math.round((px * -uy + py * ux) / len * 100);

				state.style[key] = bow;
			});
		};

		// One handle: the arc paints symmetrically, so bow alone describes it.
		Graph.handleFactory['mxgraph.oliabak.arc'] = function(state)
		{
			var h = bowHandle(state, 'bow', 1 / 3, DEFAULT_BOW);

			return (h != null) ? [h] : null;
		};

		// Two independent handles.
		Graph.handleFactory['mxgraph.oliabak.scurve'] = function(state)
		{
			var h1 = bowHandle(state, 'bow', 1 / 3, DEFAULT_BOW);
			var h2 = bowHandle(state, 'bow2', 2 / 3, -DEFAULT_BOW);
			var out = [];

			if (h1 != null) { out.push(h1); }
			if (h2 != null) { out.push(h2); }

			return (out.length > 0) ? out : null;
		};

		/**
		 * Two handles. The curvature one sits on the tube's crest so it can be
		 * dragged straight or bowed either way in one gesture; the width one
		 * sits on the upper wall at the left mouth. Both are driven off the
		 * shape's own geometry rather than a second copy of the arithmetic.
		 */
		function tunnelGeometry(state, bounds)
		{
			var shape = mxCellRenderer.defaultShapes['mxgraph.oliabak.tunnel'];

			return shape.prototype.getTunnelGeometry(state.style, bounds.x,
				bounds.y, bounds.width, bounds.height);
		};

		Graph.handleFactory['mxgraph.oliabak.tunnel'] = function(state)
		{
			return [Graph.createHandle(state, ['tunnelBow'], function(bounds)
			{
				var g = tunnelGeometry(state, bounds);

				return new mxPoint(bounds.x + bounds.width / 2,
					g.cy - g.apex - g.thick / 2);
			}, function(bounds, pt)
			{
				var g = tunnelGeometry(state, bounds);

				if (g.clearance <= 0)
				{
					return;
				}

				// Undo the half-thickness the handle is drawn above the centre
				// line by, then express the result as a share of the clearance.
				var apex = g.cy - (pt.y + g.thick / 2);

				state.style['tunnelBow'] = Math.round(Math.max(-100,
					Math.min(100, apex / g.clearance * 100)));
			}), Graph.createHandle(state, ['tunnelWidth'], function(bounds)
			{
				var g = tunnelGeometry(state, bounds);

				return new mxPoint(bounds.x, g.cy - g.thick / 2);
			}, function(bounds, pt)
			{
				var thick = 2 * (bounds.y + bounds.height / 2 - pt.y);

				state.style['tunnelWidth'] = Math.round(Math.max(0.05,
					Math.min(0.9, thick / bounds.height)) * 100) / 100;
			})];
		};

		Graph.handleFactory['mxgraph.oliabak.curvedPipe'] =
			Graph.handleFactory['mxgraph.oliabak.tunnel'];

		/**
		 * Band width and stage count. Stages is primarily a Format panel field,
		 * since a count is a number rather than a position, but a handle that
		 * sweeps the range makes trying a few counts quicker than typing them.
		 */
		Graph.handleFactory['mxgraph.oliabak.infinity'] = function(state)
		{
			function geo(bounds)
			{
				var shape = mxCellRenderer.defaultShapes['mxgraph.oliabak.infinity'];

				return shape.prototype.getLoopGeometry(state.style, bounds.x,
					bounds.y, bounds.width, bounds.height);
			};

			return [Graph.createHandle(state, ['bandWidth'], function(bounds)
			{
				var g = geo(bounds);

				// On the outer wall at the right-hand tip, where the band runs
				// vertically and the width reads directly off the pointer.
				return new mxPoint(g.cx + g.ax, g.cy - g.hb);
			}, function(bounds, pt)
			{
				var v = 2 * (bounds.y + bounds.height / 2 - pt.y) / bounds.height;

				state.style['bandWidth'] = Math.round(Math.max(0.06,
					Math.min(0.5, v)) * 100) / 100;
			}), Graph.createHandle(state, ['stages'], function(bounds)
			{
				var n = Math.max(4, Math.min(24, mxUtils.getValue(
					state.style, 'stages', 8)));

				return new mxPoint(bounds.x + bounds.width * (n - 4) / 20,
					bounds.y);
			}, function(bounds, pt)
			{
				state.style['stages'] = Math.max(4, Math.min(24, Math.round(
					4 + (pt.x - bounds.x) / bounds.width * 20)));
			})];
		};

		// Same contract as draw.io's own cylinder: size is the ellipse radius
		// in pixels and the handle rides the left edge, so the gesture is the
		// one people already know from cylinder2 and cylinder3.
		// Depth handle on the top-left corner: drag down to deepen the box.
		Graph.handleFactory['mxgraph.oliabak.switch'] = function(state)
		{
			return [Graph.createHandle(state, ['size'], function(bounds)
			{
				var d = Math.max(0, Math.min(Math.min(bounds.width, bounds.height) * 0.7,
					parseFloat(mxUtils.getValue(this.state.style, 'size',
					mxShapeOliabakSwitch.prototype.size))));

				return new mxPoint(bounds.x, bounds.y + d);
			}, function(bounds, pt)
			{
				this.state.style['size'] = Math.round(Math.max(0,
					Math.min(Math.min(bounds.width, bounds.height) * 0.7,
					pt.y - bounds.y)));
			}, true)];
		};

		Graph.handleFactory['mxgraph.oliabak.router'] = function(state)
		{
			return [Graph.createHandle(state, ['size'], function(bounds)
			{
				var size = Math.max(0, Math.min(bounds.height * 0.5, parseFloat(
					mxUtils.getValue(this.state.style, 'size',
					mxShapeOliabakRouter.prototype.size))));

				return new mxPoint(bounds.x, bounds.y + size);
			}, function(bounds, pt)
			{
				this.state.style['size'] = Math.round(Math.max(0,
					Math.min(bounds.height * 0.5, pt.y - bounds.y)));
			}, true)];
		};

		/**
		 * Band width, chevron depth and label position, on the segment itself.
		 * Everything is read back in the loop's unit space so a drag means the
		 * same thing on a stretched loop as on a square one.
		 */
		Graph.handleFactory['mxgraph.oliabak.loopSegment'] = function(state)
		{
			function geo(bounds)
			{
				var shape = mxCellRenderer.defaultShapes['mxgraph.oliabak.infinity'];

				return shape.prototype.getLoopGeometry(state.style, bounds.x,
					bounds.y, bounds.width, bounds.height);
			};

			function index(g)
			{
				return Math.max(0, Math.min(g.n - 1,
					Math.round(mxUtils.getValue(state.style, 'loopIndex', 0))));
			};

			function span(g)
			{
				var k = index(g);

				return [g.bounds[k], (k + 1 < g.n) ? g.bounds[k + 1] : g.total];
			};

			// Nearest arc length on this segment to a point, by sampling.
			function nearest(g, pt)
			{
				var sp = span(g);
				var best = sp[0], bd = Infinity;

				for (var i = 0; i <= 48; i++)
				{
					var s = sp[0] + (sp[1] - sp[0]) * i / 48;
					var q = loopPoint(g, s);
					var d = Math.pow(q[0] - pt.x, 2) + Math.pow(q[1] - pt.y, 2);

					if (d < bd) { bd = d; best = s; }
				}

				return best;
			};

			return [Graph.createHandle(state, ['bandWidth'], function(bounds)
			{
				var g = geo(bounds), sp = span(g);
				var f = loopFrame(g, (sp[0] + sp[1]) / 2);
				var hbx = g.hb * Math.min(g.sx, g.sy);

				return new mxPoint(f.x + f.nx * hbx, f.y + f.ny * hbx);
			}, function(bounds, pt)
			{
				var g = geo(bounds), sp = span(g);
				var f = loopFrame(g, (sp[0] + sp[1]) / 2);
				var d = Math.abs((pt.x - f.x) * f.nx + (pt.y - f.y) * f.ny);

				state.style['bandWidth'] = Math.round(Math.max(0.06, Math.min(0.6,
					d / Math.min(g.sx, g.sy))) * 100) / 100;
			}), Graph.createHandle(state, ['notch'], function(bounds)
			{
				var g = geo(bounds), sp = span(g);
				var tip = loopPoint(g, sp[1] + g.notch * g.hb);

				return new mxPoint(tip[0], tip[1]);
			}, function(bounds, pt)
			{
				var g = geo(bounds), sp = span(g);
				var base = loopPoint(g, sp[1]);
				var d = Math.sqrt(Math.pow(pt.x - base[0], 2) + Math.pow(pt.y - base[1], 2));

				state.style['notch'] = Math.round(Math.max(0, Math.min(2.5,
					(d / Math.min(g.sx, g.sy)) / g.hb)) * 100) / 100;
			}), Graph.createHandle(state, ['labelPos'], function(bounds)
			{
				var g = geo(bounds), sp = span(g);
				var pos = mxUtils.getValue(state.style, 'labelPos', (index(g) == 0) ? 0.24 : 0.5);
				var q = loopPoint(g, sp[0] + (sp[1] - sp[0]) * pos);

				return new mxPoint(q[0], q[1]);
			}, function(bounds, pt)
			{
				var g = geo(bounds), sp = span(g);
				var s = nearest(g, pt);

				state.style['labelPos'] = Math.round(Math.max(0.05, Math.min(0.95,
					(s - sp[0]) / (sp[1] - sp[0]))) * 100) / 100;
			})];
		};
		/**
		 * Sweep, ring width and chevron depth. All three are read back off the
		 * pointer's angle or radius about the ring's centre, so a drag follows
		 * the mouse round the circle instead of tracking one axis.
		 */
		Graph.handleFactory['mxgraph.oliabak.arcChevron'] = function(state)
		{
			function geo(bounds)
			{
				var shape = mxCellRenderer.defaultShapes['mxgraph.oliabak.arcChevron'];

				return shape.prototype.getArcGeometry(state.style, bounds.x,
					bounds.y, bounds.width, bounds.height);
			};

			// Angle of pt about the ring centre, unwrapped to sit within half a
			// turn of 'near' so a drag past the 180 degree seam does not jump.
			function angleAt(g, pt, near)
			{
				var a = Math.atan2(pt.y - g.cy, pt.x - g.cx);

				while (a - near > Math.PI) { a -= 2 * Math.PI; }
				while (near - a > Math.PI) { a += 2 * Math.PI; }

				return a;
			};

			return [Graph.createHandle(state, ['sweep'], function(bounds)
			{
				var g = geo(bounds);

				return new mxPoint(g.cx + Math.cos(g.a1) * g.ro,
					g.cy + Math.sin(g.a1) * g.ro);
			}, function(bounds, pt)
			{
				var g = geo(bounds);
				var a = angleAt(g, pt, g.a1);

				state.style['sweep'] = Math.round(Math.max(2, Math.min(355,
					(a - g.a0) * 180 / Math.PI)));
			}), Graph.createHandle(state, ['ringWidth'], function(bounds)
			{
				var g = geo(bounds);
				var am = (g.a0 + g.a1) / 2;

				return new mxPoint(g.cx + Math.cos(am) * g.ri,
					g.cy + Math.sin(am) * g.ri);
			}, function(bounds, pt)
			{
				var g = geo(bounds);
				var d = Math.sqrt(Math.pow(pt.x - g.cx, 2) + Math.pow(pt.y - g.cy, 2));

				state.style['ringWidth'] = Math.round(Math.max(0.05,
					Math.min(0.95, 1 - d / g.ro)) * 100) / 100;
			}), Graph.createHandle(state, ['notch'], function(bounds)
			{
				var g = geo(bounds);
				var rm = (g.ri + g.ro) / 2;

				return new mxPoint(g.cx + Math.cos(g.a1 + g.notch) * rm,
					g.cy + Math.sin(g.a1 + g.notch) * rm);
			}, function(bounds, pt)
			{
				var g = geo(bounds);
				var a = angleAt(g, pt, g.a1 + g.notch);

				state.style['notch'] = Math.round(Math.max(-45, Math.min(45,
					(a - g.a1) * 180 / Math.PI)));
			})];
		};
	}
})();
