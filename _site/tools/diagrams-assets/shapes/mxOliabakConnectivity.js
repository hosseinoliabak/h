/**
 * Oliabak connectivity library: the physical layer.
 *
 * Added 2026-09-11 by Hossein Oliabak as part of Diagrams.
 * Licensed under the Apache License 2.0.
 *
 * Original work for this fork. draw.io ships nothing for this layer: no cable
 * types, no connectors, no NICs, and only three port-row glyphs for
 * pluggables, drawn at rack scale. Everything here is drawn from parameters
 * rather than as fixed paths, so a palette entry is only a starting value of
 * a live property and every shape stays adjustable after it is dropped.
 *
 * Namespace mxgraph.oliabak.conn.*, loaded on demand through
 * mxStencilRegistry.libraries['oliabak/conn'].
 *
 * Colours follow the classic device family: fillColor is the body,
 * strokeColor the outline, strokeColor2 the markings (latches, boots, tabs,
 * LEDs, dust caps), all live style keys. The cable edge is the one exception:
 * its strokeColor is the jacket, since that is what the Line colour picker
 * sets, and the presets carry the real jacket colours of the media.
 */
(function()
{
	var MARK = '#CC0000';

	function bodyColor(shape)
	{
		return mxUtils.getValue(shape.style, mxConstants.STYLE_FILLCOLOR, shape.fill) ||
			'#C8C8C8';
	};

	function markColor(shape)
	{
		return mxUtils.getValue(shape.style, 'strokeColor2', MARK);
	};

	function lineColor(shape)
	{
		return mxUtils.getValue(shape.style, mxConstants.STYLE_STROKECOLOR, shape.stroke) ||
			'#4D4D4D';
	};

	function num(style, key, dflt, min, max)
	{
		var v = parseFloat(mxUtils.getValue(style, key, dflt));

		if (isNaN(v))
		{
			v = dflt;
		}

		return Math.max(min, Math.min(max, v));
	};

	function bool(style, key, dflt)
	{
		return mxUtils.getValue(style, key, dflt ? '1' : '0') != '0';
	};

	// Mix a hex colour towards white (amount > 0) or black (amount < 0).
	function shade(color, amount)
	{
		if (typeof color !== 'string' || color.charAt(0) != '#')
		{
			return color;
		}

		var hex = color.substring(1);

		if (hex.length == 3)
		{
			hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) +
				hex.charAt(2) + hex.charAt(2);
		}

		if (!/^[0-9a-fA-F]{6}$/.test(hex))
		{
			return color;
		}

		var target = amount > 0 ? 255 : 0, t = Math.abs(amount), out = '#';

		for (var i = 0; i < 3; i++)
		{
			var v = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
			v = Math.round(v + (target - v) * t);
			out += ('0' + Math.max(0, Math.min(255, v)).toString(16)).slice(-2);
		}

		return out;
	};

	function colors(shape)
	{
		return {body: bodyColor(shape), mark: markColor(shape), line: lineColor(shape)};
	};

	function init(shape, bounds, fill, stroke, strokewidth)
	{
		mxShape.call(shape);
		shape.bounds = bounds;
		shape.fill = fill;
		shape.stroke = stroke;
		shape.strokewidth = (strokewidth != null) ? strokewidth : 1;
	};

	var MARKING_PROP = {name: 'strokeColor2', dispName: 'Marking Color',
		type: 'color', defVal: MARK};

	var PLUG_KINDS = [{val: 'lc', dispName: 'LC'}, {val: 'sc', dispName: 'SC'},
		{val: 'st', dispName: 'ST'}, {val: 'mpo', dispName: 'MPO / MTP'},
		{val: 'rj45', dispName: 'RJ45'}, {val: 'ftype', dispName: 'F-type'},
		{val: 'bnc', dispName: 'BNC'}, {val: 'sfp', dispName: 'SFP module'},
		{val: 'qsfp', dispName: 'QSFP module'}];

	// ---------------------------------------------------------------------
	// Pen: draws in a local frame whose x axis may run either way, so one
	// plug painter serves a plug pointing left, right, or along an edge.
	// ---------------------------------------------------------------------

	function Pen(c, dir)
	{
		this.c = c;
		this.dir = dir;
	};

	Pen.prototype.x = function(u)
	{
		return this.dir * u;
	};

	Pen.prototype.rect = function(u0, u1, y0, y1, r)
	{
		var a = this.x(u0), b = this.x(u1);
		var x = Math.min(a, b), w = Math.abs(b - a);
		this.c.begin();

		if (r > 0)
		{
			this.c.roundrect(x, y0, w, y1 - y0, r, r);
		}
		else
		{
			this.c.rect(x, y0, w, y1 - y0);
		}

		this.c.fillAndStroke();
	};

	Pen.prototype.ellipse = function(u0, u1, y0, y1)
	{
		var a = this.x(u0), b = this.x(u1);
		this.c.begin();
		this.c.ellipse(Math.min(a, b), y0, Math.abs(b - a), y1 - y0);
		this.c.fillAndStroke();
	};

	Pen.prototype.poly = function(pts)
	{
		this.c.begin();

		for (var i = 0; i < pts.length; i++)
		{
			if (i == 0)
			{
				this.c.moveTo(this.x(pts[i][0]), pts[i][1]);
			}
			else
			{
				this.c.lineTo(this.x(pts[i][0]), pts[i][1]);
			}
		}

		this.c.close();
		this.c.fillAndStroke();
	};

	Pen.prototype.lines = function(segs)
	{
		this.c.begin();

		for (var i = 0; i < segs.length; i++)
		{
			this.c.moveTo(this.x(segs[i][0]), segs[i][1]);
			this.c.lineTo(this.x(segs[i][2]), segs[i][3]);
		}

		this.c.stroke();
	};

	/**
	 * Paints one plug at the origin: the boot begins at u = 0, the tip is at
	 * u = len, the centre line is y = 0 and the plug is h tall. dir is +1 for
	 * a plug pointing right and -1 for one pointing left.
	 */
	function paintPlug(c, kind, len, h, dir, col, bootFrac, boot)
	{
		var p = new Pen(c, dir);
		var b = boot ? len * bootFrac : 0;
		var L = len - b;
		var r = Math.min(L, h) * 0.1;
		var sw = c.state.strokeWidth;

		if (boot)
		{
			c.setFillColor(col.mark);
			p.poly([[0, -h * 0.16], [b, -h * 0.26], [b, h * 0.26], [0, h * 0.16]]);
		}

		c.setFillColor(col.body);

		if (kind == 'lc' || kind == 'sc')
		{
			var hw = L * (kind == 'lc' ? 0.5 : 0.62);
			var hh = h * (kind == 'lc' ? 0.6 : 0.78);
			p.rect(b, b + hw, -hh / 2, hh / 2, r);

			if (kind == 'lc')
			{
				c.setFillColor(shade(col.body, -0.3));
				p.poly([[b + hw * 0.15, -hh / 2], [b + hw * 0.55, -hh / 2 - h * 0.16],
					[b + hw * 0.85, -hh / 2]]);
			}

			c.setFillColor(shade(col.body, 0.35));
			p.rect(b + hw, len, -h * 0.11, h * 0.11, 0);
		}
		else if (kind == 'st')
		{
			var bw = L * 0.55;
			p.rect(b, b + bw, -h * 0.32, h * 0.32, h * 0.3);
			c.setFillColor(shade(col.body, -0.3));
			p.rect(b + bw * 0.55, b + bw * 0.75, -h * 0.4, h * 0.4, 0);
			c.setFillColor(shade(col.body, 0.35));
			p.rect(b + bw, len, -h * 0.11, h * 0.11, 0);
		}
		else if (kind == 'mpo')
		{
			var hw = L * 0.6;
			p.rect(b, b + hw, -h * 0.34, h * 0.34, r);
			c.setFillColor(shade(col.body, -0.3));
			p.rect(b + hw * 0.4, b + hw * 0.6, -h * 0.44, -h * 0.34, 0);
			c.setFillColor(shade(col.body, 0.35));
			p.rect(b + hw, len, -h * 0.22, h * 0.22, 0);
		}
		else if (kind == 'rj45')
		{
			p.poly([[b, -h * 0.3], [b + L * 0.72, -h * 0.3], [b + L * 0.72, -h * 0.42],
				[len, -h * 0.42], [len, h * 0.42], [b + L * 0.72, h * 0.42],
				[b + L * 0.72, h * 0.3], [b, h * 0.3]]);
			c.setFillColor(col.mark);
			p.poly([[b + L * 0.2, -h * 0.3], [b + L * 0.32, -h * 0.5], [b + L * 0.88, -h * 0.5],
				[b + L * 0.88, -h * 0.42], [b + L * 0.72, -h * 0.42], [b + L * 0.72, -h * 0.3]]);
			c.setStrokeColor(shade(col.body, -0.55));
			c.setStrokeWidth(sw * 0.6);
			var segs = [];

			for (var i = 0; i < 8; i++)
			{
				var cy = -h * 0.3 + (h * 0.6) * (i + 0.5) / 8;
				segs.push([b + L * 0.8, cy, len, cy]);
			}

			p.lines(segs);
			c.setStrokeWidth(sw);
			c.setStrokeColor(col.line);
		}
		else if (kind == 'ftype' || kind == 'bnc')
		{
			var bw = L * 0.45;
			var n0 = b + bw * 0.9, n1 = n0 + L * 0.32;
			p.rect(b, b + bw, -h * 0.28, h * 0.28, r);
			c.setFillColor(shade(col.body, -0.3));
			p.rect(n0, n1, -h * 0.42, h * 0.42, r);

			if (kind == 'ftype')
			{
				c.setStrokeColor(shade(col.body, -0.55));
				p.lines([[n0, -h * 0.14, n1, -h * 0.14], [n0, h * 0.14, n1, h * 0.14]]);
				c.setStrokeColor(col.line);
			}
			else
			{
				c.setFillColor(shade(col.body, -0.55));
				p.rect(n0 + L * 0.1, n0 + L * 0.16, -h * 0.5, -h * 0.4, 0);
				p.rect(n0 + L * 0.1, n0 + L * 0.16, h * 0.4, h * 0.5, 0);
			}

			c.setFillColor(col.mark);
			p.rect(n1, len, -h * 0.05, h * 0.05, 0);
		}
		else if (kind == 'sfp' || kind == 'qsfp')
		{
			// A module as the cable's end, the DAC and AOC case.
			var hh = h * (kind == 'sfp' ? 0.8 : 0.9);
			p.rect(b, len, -hh / 2, hh / 2, r);
			c.setFillColor(shade(col.body, -0.35));
			p.rect(len - L * 0.22, len, -hh / 2, hh / 2, r);
			c.setFillColor(col.mark);

			if (kind == 'sfp')
			{
				p.rect(b, b + L * 0.12, -hh * 0.3, hh * 0.3, r * 0.5);
			}
			else
			{
				p.rect(b - h * 0.05, b + L * 0.25, -hh * 0.2, hh * 0.2, r * 0.5);
			}
		}

		c.setFillColor(col.body);
	};

	/**
	 * Paints a socket seen from the front inside the given box. Shared by the
	 * port shape, the patch panel, the NIC and the media converter.
	 */
	function paintPortFace(c, kind, x, y, w, h, col, leds)
	{
		var r = Math.min(w, h) * 0.12;
		var dark = shade(col.body, -0.75);
		var rim = shade(col.body, -0.3);

		if (kind == 'rj45')
		{
			c.setFillColor(rim);
			c.begin();
			c.roundrect(x, y, w, h, r, r);
			c.fillAndStroke();
			c.setFillColor(dark);
			c.begin();
			c.moveTo(x + w * 0.15, y + h * 0.15);
			c.lineTo(x + w * 0.85, y + h * 0.15);
			c.lineTo(x + w * 0.85, y + h * 0.62);
			c.lineTo(x + w * 0.68, y + h * 0.62);
			c.lineTo(x + w * 0.68, y + h * 0.85);
			c.lineTo(x + w * 0.32, y + h * 0.85);
			c.lineTo(x + w * 0.32, y + h * 0.62);
			c.lineTo(x + w * 0.15, y + h * 0.62);
			c.close();
			c.fill();
			c.setStrokeColor(shade(col.body, 0.3));
			c.setStrokeWidth(c.state.strokeWidth * 0.5);
			c.begin();

			for (var i = 0; i < 8; i++)
			{
				var cx = x + w * 0.22 + (w * 0.56) * i / 7;
				c.moveTo(cx, y + h * 0.17);
				c.lineTo(cx, y + h * 0.36);
			}

			c.stroke();
			c.setStrokeWidth(c.state.strokeWidth * 2);
			c.setStrokeColor(col.line);
		}
		else if (kind == 'sfp' || kind == 'qsfp')
		{
			c.setFillColor(rim);
			c.begin();
			c.roundrect(x, y, w, h, r, r);
			c.fillAndStroke();
			c.setFillColor(dark);
			c.begin();
			c.rect(x + w * 0.1, y + h * 0.18, w * 0.8, h * 0.64);
			c.fill();

			if (kind == 'sfp')
			{
				c.setFillColor(shade(col.body, -0.5));
				var d = h * 0.3;
				c.begin();
				c.ellipse(x + w * 0.28 - d / 2, y + h * 0.5 - d / 2, d, d);
				c.fill();
				c.begin();
				c.ellipse(x + w * 0.72 - d / 2, y + h * 0.5 - d / 2, d, d);
				c.fill();
			}
		}
		else if (kind == 'lc' || kind == 'sc')
		{
			// A duplex adapter: two square bores side by side.
			c.setFillColor(rim);
			c.begin();
			c.roundrect(x, y, w, h, r, r);
			c.fillAndStroke();
			c.setFillColor(dark);
			var bw = w * (kind == 'lc' ? 0.34 : 0.4);
			var bh = h * (kind == 'lc' ? 0.6 : 0.72);

			for (var i = 0; i < 2; i++)
			{
				var bx = x + w * 0.5 + (i == 0 ? -bw - w * 0.04 : w * 0.04);
				c.begin();
				c.rect(bx, y + (h - bh) / 2, bw, bh);
				c.fill();
			}
		}
		else if (kind == 'mpo')
		{
			c.setFillColor(rim);
			c.begin();
			c.roundrect(x, y, w, h, r, r);
			c.fillAndStroke();
			c.setFillColor(dark);
			c.begin();
			c.rect(x + w * 0.12, y + h * 0.3, w * 0.76, h * 0.4);
			c.fill();
			c.begin();
			c.rect(x + w * 0.42, y + h * 0.18, w * 0.16, h * 0.12);
			c.fill();
		}
		else if (kind == 'bnc' || kind == 'ftype')
		{
			var d = Math.min(w, h);
			var cx = x + w / 2, cy = y + h / 2;
			c.setFillColor(rim);
			c.begin();
			c.ellipse(cx - d / 2, cy - d / 2, d, d);
			c.fillAndStroke();
			c.setFillColor(dark);
			c.begin();
			c.ellipse(cx - d * 0.3, cy - d * 0.3, d * 0.6, d * 0.6);
			c.fill();
			c.setFillColor(col.mark);
			c.begin();
			c.ellipse(cx - d * 0.07, cy - d * 0.07, d * 0.14, d * 0.14);
			c.fill();
		}

		// Link and activity LEDs above the port, in the marking colour.
		if (leds > 0)
		{
			c.setFillColor(col.mark);
			var d = Math.min(w * 0.14, h * 0.18);

			for (var i = 0; i < leds; i++)
			{
				var lx = (leds == 1) ? x + w / 2 : x + w * 0.2 + (w * 0.6) * i / (leds - 1);
				c.begin();
				c.ellipse(lx - d / 2, y - d * 1.4, d, d);
				c.fill();
			}
		}

		c.setFillColor(col.body);
	};

	// The standard jacket colours, by media, used by the cable presets and
	// exposed here so the icon can borrow one on request.
	var MEDIA = {
		os2:  {color: '#F2D600', plug: 'lc',   duplex: true,  width: 4},
		om1:  {color: '#F28C28', plug: 'lc',   duplex: true,  width: 4},
		om3:  {color: '#4FD1E5', plug: 'lc',   duplex: true,  width: 4},
		om5:  {color: '#B5D334', plug: 'lc',   duplex: true,  width: 4},
		mpo:  {color: '#4FD1E5', plug: 'mpo',  duplex: false, width: 6},
		cat5: {color: '#2E6FD8', plug: 'rj45', duplex: false, width: 5},
		cat6a:{color: '#2E6FD8', plug: 'rj45', duplex: false, width: 7},
		coax: {color: '#222222', plug: 'ftype', duplex: false, width: 6},
		dac:  {color: '#3D3D3D', plug: 'sfp',  duplex: false, width: 7},
		aoc:  {color: '#2F4F6F', plug: 'qsfp', duplex: false, width: 6}
	};

	var MEDIA_LIST = [{val: 'family', dispName: 'Grey (family)'},
		{val: 'os2', dispName: 'Fibre OS2 single-mode'},
		{val: 'om1', dispName: 'Fibre OM1 / OM2'}, {val: 'om3', dispName: 'Fibre OM3 / OM4'},
		{val: 'om5', dispName: 'Fibre OM5'}, {val: 'mpo', dispName: 'MPO / MTP trunk'},
		{val: 'cat5', dispName: 'Copper Cat5e / Cat6'}, {val: 'cat6a', dispName: 'Copper Cat6a'},
		{val: 'coax', dispName: 'Coax'}, {val: 'dac', dispName: 'DAC twinax'},
		{val: 'aoc', dispName: 'AOC'}];

	// ---------------------------------------------------------------------
	// Pluggable transceiver
	// ---------------------------------------------------------------------

	/**
	 * A pluggable module seen from above: the port face on the left, the
	 * body running right, the latch at the far end.
	 *
	 * 'form' picks the family and with it the details that tell them apart:
	 * an SFP has a duplex LC face and a bail latch, a QSFP a single MPO
	 * aperture and a pull tab, QSFP-DD and OSFP add heatsink ridges, a GBIC is
	 * the old chunky SC unit. Each of those details is also its own property,
	 * so a form is only a set of defaults and any of them can be overridden.
	 */
	function mxShapeOliabakPluggable(bounds, fill, stroke, strokewidth)
	{
		init(this, bounds, fill, stroke, strokewidth);
	};

	mxUtils.extend(mxShapeOliabakPluggable, mxShape);

	var FORMS = {
		gbic:     {apertures: 2, round: false, latch: 'tab',  ridges: 0, face: 0.30},
		sfp:      {apertures: 2, round: true,  latch: 'bail', ridges: 0, face: 0.22},
		sfpplus:  {apertures: 2, round: true,  latch: 'bail', ridges: 0, face: 0.22},
		sfp28:    {apertures: 2, round: true,  latch: 'bail', ridges: 0, face: 0.22},
		qsfpplus: {apertures: 1, round: false, latch: 'tab',  ridges: 0, face: 0.24},
		qsfp28:   {apertures: 1, round: false, latch: 'tab',  ridges: 0, face: 0.24},
		qsfpdd:   {apertures: 1, round: false, latch: 'tab',  ridges: 3, face: 0.24},
		osfp:     {apertures: 1, round: false, latch: 'tab',  ridges: 4, face: 0.26}
	};

	mxShapeOliabakPluggable.prototype.customProperties = [
		{name: 'form', dispName: 'Form Factor', type: 'enum', defVal: 'sfpplus',
			enumList: [{val: 'gbic', dispName: 'GBIC'}, {val: 'sfp', dispName: 'SFP'},
				{val: 'sfpplus', dispName: 'SFP+'}, {val: 'sfp28', dispName: 'SFP28'},
				{val: 'qsfpplus', dispName: 'QSFP+'}, {val: 'qsfp28', dispName: 'QSFP28'},
				{val: 'qsfpdd', dispName: 'QSFP-DD'}, {val: 'osfp', dispName: 'OSFP'}]},
		{name: 'apertures', dispName: 'Apertures (-1 = from form)', type: 'int',
			min: -1, max: 4, defVal: -1},
		{name: 'latch', dispName: 'Latch', type: 'enum', defVal: 'auto',
			enumList: [{val: 'auto', dispName: 'From Form'}, {val: 'bail', dispName: 'Bail'},
				{val: 'tab', dispName: 'Pull Tab'}, {val: 'none', dispName: 'None'}]},
		{name: 'ridges', dispName: 'Heatsink Ridges (-1 = from form)', type: 'int',
			min: -1, max: 8, defVal: -1},
		{name: 'faceDepth', dispName: 'Face Depth (-1 = from form)', type: 'float',
			min: -1, max: 0.5, defVal: -1},
		{name: 'showCage', dispName: 'Show Cage', type: 'bool', defVal: false},
		MARKING_PROP
	];

	mxShapeOliabakPluggable.prototype.resolve = function(style)
	{
		var f = FORMS[mxUtils.getValue(style, 'form', 'sfpplus')] || FORMS.sfpplus;
		var pick = function(key, dflt, max)
		{
			var v = parseFloat(mxUtils.getValue(style, key, -1));

			return (isNaN(v) || v < 0) ? dflt : Math.min(max, v);
		};
		var latch = mxUtils.getValue(style, 'latch', 'auto');

		return {
			apertures: Math.round(pick('apertures', f.apertures, 4)),
			round: f.round,
			latch: (latch == 'auto') ? f.latch : latch,
			ridges: Math.round(pick('ridges', f.ridges, 8)),
			face: Math.max(0.08, pick('faceDepth', f.face, 0.5)),
			cage: bool(style, 'showCage', false)
		};
	};

	mxShapeOliabakPluggable.prototype.paintVertexShape = function(c, x, y, w, h)
	{
		if (!(w > 0) || !(h > 0))
		{
			return;
		}

		var p = this.resolve(this.style);
		var col = colors(this);
		var faceW = w * p.face;
		var r = Math.min(w, h) * 0.08;
		var latchW = (p.latch == 'none') ? 0 : w * 0.16;
		var bodyW = w - latchW;

		c.translate(x, y);

		// Cage: the socket the module slides into, drawn behind and darker.
		if (p.cage)
		{
			c.setFillColor(shade(col.body, -0.25));
			c.begin();
			c.roundrect(faceW * 0.6, h * 0.06, bodyW - faceW * 0.6 + latchW * 0.5,
				h * 0.88, r, r);
			c.fillAndStroke();
		}

		c.setFillColor(col.body);
		c.begin();
		c.roundrect(0, 0, bodyW, h, r, r);
		c.fillAndStroke();

		// Port face: a darker plate on the left with the apertures.
		c.setFillColor(shade(col.body, -0.35));
		c.begin();
		c.roundrect(0, 0, faceW, h, r, r);
		c.fillAndStroke();

		if (p.apertures > 0)
		{
			c.setFillColor(shade(col.body, -0.75));
			var slotH = h * 0.42;
			var gap = h * 0.08;
			var totalH = p.apertures * slotH + (p.apertures - 1) * gap;
			var y0 = (h - totalH) / 2;

			for (var i = 0; i < p.apertures; i++)
			{
				var ay = y0 + i * (slotH + gap);
				c.begin();

				if (p.round)
				{
					var d = Math.min(faceW * 0.55, slotH);
					c.ellipse(faceW * 0.5 - d / 2, ay + (slotH - d) / 2, d, d);
				}
				else
				{
					c.roundrect(faceW * 0.18, ay + slotH * 0.15, faceW * 0.64,
						slotH * 0.7, r * 0.5, r * 0.5);
				}

				c.fillAndStroke();
			}
		}

		if (p.ridges > 0)
		{
			c.setStrokeColor(shade(col.body, -0.4));
			var x0 = faceW + (bodyW - faceW) * 0.12;
			var x1 = bodyW - (bodyW - faceW) * 0.12;
			c.begin();

			for (var i = 0; i < p.ridges; i++)
			{
				var ry = h * (0.22 + 0.56 * i / Math.max(1, p.ridges - 1));
				c.moveTo(x0, ry);
				c.lineTo(x1, ry);
			}

			c.stroke();
			c.setStrokeColor(col.line);
		}

		// Latch in the marking colour: a bail is a wire loop that swings out,
		// a pull tab is a flat strap.
		if (p.latch == 'bail')
		{
			c.setStrokeColor(col.mark);
			c.setStrokeWidth(Math.max(1.5, this.strokewidth * 1.4));
			c.setFillColor(mxConstants.NONE);
			c.begin();
			c.moveTo(bodyW, h * 0.28);
			c.lineTo(bodyW + latchW * 0.8, h * 0.28);
			c.arcTo(latchW * 0.45, h * 0.22, 0, 0, 1, bodyW + latchW * 0.8, h * 0.72);
			c.lineTo(bodyW, h * 0.72);
			c.stroke();
			c.setStrokeWidth(this.strokewidth);
			c.setStrokeColor(col.line);
		}
		else if (p.latch == 'tab')
		{
			c.setFillColor(col.mark);
			c.begin();
			c.roundrect(bodyW - latchW * 0.1, h * 0.32, latchW * 1.05, h * 0.36,
				r * 0.6, r * 0.6);
			c.fillAndStroke();
		}
	};

	mxCellRenderer.registerShape('mxgraph.oliabak.conn.pluggable',
		mxShapeOliabakPluggable);

	// ---------------------------------------------------------------------
	// Connector
	// ---------------------------------------------------------------------

	/**
	 * A cable-end connector, plug pointing right, with the strain relief boot
	 * in the marking colour behind it. Duplex doubles it where that exists
	 * (LC, SC). Turn it with the stock rotation and flip styles.
	 */
	function mxShapeOliabakConnector(bounds, fill, stroke, strokewidth)
	{
		init(this, bounds, fill, stroke, strokewidth);
	};

	mxUtils.extend(mxShapeOliabakConnector, mxShape);

	mxShapeOliabakConnector.prototype.customProperties = [
		{name: 'kind', dispName: 'Connector', type: 'enum', defVal: 'lc',
			enumList: PLUG_KINDS},
		{name: 'duplex', dispName: 'Duplex', type: 'bool', defVal: false},
		{name: 'boot', dispName: 'Boot', type: 'bool', defVal: true},
		{name: 'bootLength', dispName: 'Boot Length', type: 'float', min: 0.1,
			max: 0.6, defVal: 0.32},
		MARKING_PROP
	];

	mxShapeOliabakConnector.prototype.paintVertexShape = function(c, x, y, w, h)
	{
		if (!(w > 0) || !(h > 0))
		{
			return;
		}

		var st = this.style;
		var kind = mxUtils.getValue(st, 'kind', 'lc');
		var duplex = bool(st, 'duplex', false) && (kind == 'lc' || kind == 'sc');
		var boot = bool(st, 'boot', true);
		var bootFrac = num(st, 'bootLength', 0.32, 0.1, 0.6);
		var col = colors(this);
		var lanes = duplex ? 2 : 1;
		var laneH = h / lanes;

		for (var i = 0; i < lanes; i++)
		{
			c.save();
			c.translate(x, y + i * laneH + laneH / 2);
			paintPlug(c, kind, w, laneH, 1, col, bootFrac, boot);
			c.restore();
		}

		// Duplex clip holding the pair together.
		if (duplex)
		{
			var b = boot ? w * bootFrac : 0;
			c.setFillColor(shade(col.body, -0.3));
			c.begin();
			c.roundrect(x + b + (w - b) * 0.12, y + h * 0.36, (w - b) * 0.22,
				h * 0.28, 2, 2);
			c.fillAndStroke();
		}
	};

	mxCellRenderer.registerShape('mxgraph.oliabak.conn.connector',
		mxShapeOliabakConnector);

	// ---------------------------------------------------------------------
	// Patch cable, as an icon
	// ---------------------------------------------------------------------

	/**
	 * A cable with a plug at each end, drawn to a box: the plugs point
	 * outwards and the jacket runs between them, sagging by 'sag' or wound
	 * into 'loops' coils in the middle. Both ends and the media are
	 * properties; 'media' only chooses defaults for the plugs, the strand
	 * count and, when asked, the jacket colour.
	 */
	function mxShapeOliabakPatchCable(bounds, fill, stroke, strokewidth)
	{
		init(this, bounds, fill, stroke, strokewidth);
	};

	mxUtils.extend(mxShapeOliabakPatchCable, mxShape);

	var END_KINDS = [{val: 'auto', dispName: 'From Media'}].concat(PLUG_KINDS);

	mxShapeOliabakPatchCable.prototype.customProperties = [
		{name: 'media', dispName: 'Media', type: 'enum', defVal: 'os2',
			enumList: MEDIA_LIST.slice(1)},
		{name: 'endA', dispName: 'Left Plug', type: 'enum', defVal: 'auto',
			enumList: END_KINDS},
		{name: 'endB', dispName: 'Right Plug', type: 'enum', defVal: 'auto',
			enumList: END_KINDS},
		{name: 'strands', dispName: 'Strands (0 = from media)', type: 'int',
			min: 0, max: 2, defVal: 0},
		{name: 'plugLength', dispName: 'Plug Length', type: 'float', min: 0.08,
			max: 0.4, defVal: 0.2},
		{name: 'sag', dispName: 'Sag', type: 'float', min: -1, max: 1, defVal: 0.5},
		{name: 'loops', dispName: 'Coils', type: 'int', min: 0, max: 5, defVal: 0},
		{name: 'jacketWidth', dispName: 'Jacket Width', type: 'float', min: 1,
			max: 20, defVal: 6},
		{name: 'jacketColor', dispName: 'Jacket Colour', type: 'enum',
			defVal: 'family', enumList: [{val: 'family', dispName: 'Grey (family)'},
				{val: 'media', dispName: 'Real jacket colour'}]},
		{name: 'boot', dispName: 'Boots', type: 'bool', defVal: true},
		MARKING_PROP
	];

	mxShapeOliabakPatchCable.prototype.resolve = function(style)
	{
		var m = MEDIA[mxUtils.getValue(style, 'media', 'os2')] || MEDIA.os2;
		var endA = mxUtils.getValue(style, 'endA', 'auto');
		var endB = mxUtils.getValue(style, 'endB', 'auto');
		var strands = Math.round(num(style, 'strands', 0, 0, 2));

		return {
			media: m,
			endA: (endA == 'auto') ? m.plug : endA,
			endB: (endB == 'auto') ? m.plug : endB,
			strands: (strands == 0) ? (m.duplex ? 2 : 1) : strands,
			plug: num(style, 'plugLength', 0.2, 0.08, 0.4),
			sag: num(style, 'sag', 0.5, -1, 1),
			loops: Math.round(num(style, 'loops', 0, 0, 5)),
			jw: num(style, 'jacketWidth', 6, 1, 20),
			real: mxUtils.getValue(style, 'jacketColor', 'family') == 'media',
			boot: bool(style, 'boot', true)
		};
	};

	// Where the jacket sits: the plug centre line drops as the cable sags so
	// the drooping run still fits the box.
	mxShapeOliabakPatchCable.prototype.centreLine = function(p, h)
	{
		return h * 0.5 - p.sag * h * 0.2;
	};

	mxShapeOliabakPatchCable.prototype.paintVertexShape = function(c, x, y, w, h)
	{
		if (!(w > 0) || !(h > 0))
		{
			return;
		}

		var p = this.resolve(this.style);
		var col = colors(this);
		var plugL = w * p.plug;
		var cy = this.centreLine(p, h);
		var ph = Math.min(h * 0.55, plugL * 0.6);
		var jacket = p.real ? p.media.color : col.body;
		var outline = p.real ? shade(p.media.color, -0.5) : col.line;
		var span = w - 2 * plugL;
		var offsets = (p.strands == 2) ? [-p.jw * 0.6, p.jw * 0.6] : [0];

		c.translate(x, y);

		// Two passes, outline then jacket, so overlapping runs read as one
		// tube instead of showing each other's edges.
		var self = this;
		var trace = function()
		{
			for (var i = 0; i < offsets.length; i++)
			{
				self.traceRun(c, p, plugL, span, cy + offsets[i], h);
			}
		};

		c.setFillColor(mxConstants.NONE);
		c.setStrokeColor(outline);
		c.setStrokeWidth(p.jw + 2 * this.strokewidth);
		trace();
		c.setStrokeColor(jacket);
		c.setStrokeWidth(p.jw);
		trace();
		c.setStrokeWidth(this.strokewidth);
		c.setStrokeColor(col.line);

		// Plugs, tip outwards, over the jacket ends.
		var bootFrac = 0.3;
		c.save();
		c.translate(plugL, cy);
		paintPlug(c, p.endA, plugL, ph, -1, col, bootFrac, p.boot);
		c.restore();
		c.save();
		c.translate(w - plugL, cy);
		paintPlug(c, p.endB, plugL, ph, 1, col, bootFrac, p.boot);
		c.restore();
	};

	mxShapeOliabakPatchCable.prototype.traceRun = function(c, p, x0, span, cy, h)
	{
		var x1 = x0 + span;

		if (p.loops > 0)
		{
			// A coil: overlapping rings in the middle, straight leads either side.
			var rr = Math.min(h * 0.32, span * 0.16);
			var step = rr * 0.5;
			var cx = x0 + span / 2;
			var first = cx - step * (p.loops - 1) / 2;
			c.begin();
			c.moveTo(x0, cy);
			c.lineTo(first - rr, cy);
			c.moveTo(first + step * (p.loops - 1) + rr, cy);
			c.lineTo(x1, cy);
			c.stroke();

			for (var i = 0; i < p.loops; i++)
			{
				c.begin();
				c.ellipse(first + step * i - rr, cy - rr, rr * 2, rr * 2);
				c.stroke();
			}
		}
		else
		{
			var drop = p.sag * h * 0.9;
			c.begin();
			c.moveTo(x0, cy);
			c.curveTo(x0 + span * 0.3, cy + drop, x1 - span * 0.3, cy + drop, x1, cy);
			c.stroke();
		}
	};

	mxCellRenderer.registerShape('mxgraph.oliabak.conn.patchCable',
		mxShapeOliabakPatchCable);

	// ---------------------------------------------------------------------
	// Cable, as an edge
	// ---------------------------------------------------------------------

	/**
	 * A connectable cable. strokeColor is the jacket and strokeWidth its
	 * thickness, so the stock Line controls do what they say; a darker
	 * outline is drawn under it so the jacket reads as a tube against any
	 * background, and a plug can be drawn at each end, turned to follow the
	 * last segment. Routing, waypoints and arrowheads are mxConnector's own.
	 */
	function mxShapeOliabakCable(points, stroke, strokewidth)
	{
		mxConnector.call(this, points, stroke, strokewidth);
	};

	mxUtils.extend(mxShapeOliabakCable, mxConnector);

	mxShapeOliabakCable.prototype.customProperties = [
		{name: 'plugs', dispName: 'Plugs', type: 'enum', defVal: 'none',
			enumList: [{val: 'none', dispName: 'None'}].concat(PLUG_KINDS)},
		{name: 'plugSize', dispName: 'Plug Length', type: 'float', min: 4,
			max: 80, defVal: 18},
		{name: 'duplex', dispName: 'Duplex Plugs', type: 'bool', defVal: false},
		{name: 'outline', dispName: 'Outline', type: 'bool', defVal: true},
		{name: 'outlineColor', dispName: 'Outline Colour', type: 'color',
			defVal: 'default'},
		{name: 'fillColor', dispName: 'Plug Body', type: 'color', defVal: '#C8C8C8'},
		MARKING_PROP
	];

	mxShapeOliabakCable.prototype.paintEdgeShape = function(c, pts)
	{
		var st = this.style;
		var jacket = this.stroke;
		var sw = this.strokewidth;
		var outlineColor = mxUtils.getValue(st, 'outlineColor', 'default');

		if (outlineColor == null || outlineColor == 'default' || outlineColor == '')
		{
			outlineColor = shade(jacket, -0.55);
		}

		// Markers offset the end points as a side effect, so they come first.
		var sourceMarker = this.createMarker(c, pts, true);
		var targetMarker = this.createMarker(c, pts, false);

		if (bool(st, 'outline', true))
		{
			c.setStrokeColor(outlineColor);
			c.setStrokeWidth(sw + 2);
			this.paintLine(c, pts, this.isRounded);
		}

		c.setStrokeColor(jacket);
		c.setStrokeWidth(sw);
		this.paintLine(c, pts, this.isRounded);

		c.setFillColor(jacket);
		c.setShadow(false);
		c.setDashed(false);

		if (sourceMarker != null)
		{
			sourceMarker();
		}

		if (targetMarker != null)
		{
			targetMarker();
		}

		var kind = mxUtils.getValue(st, 'plugs', 'none');

		if (kind != 'none' && pts.length >= 2)
		{
			var col = {body: mxUtils.getValue(st, mxConstants.STYLE_FILLCOLOR, '#C8C8C8'),
				mark: mxUtils.getValue(st, 'strokeColor2', MARK), line: outlineColor};
			var len = num(st, 'plugSize', 18, 4, 80);
			var duplex = bool(st, 'duplex', false) && (kind == 'lc' || kind == 'sc');
			// Plugs are outlined in the outline colour, thinly: a plug is a
			// few pixels tall and a jacket-wide stroke would swallow it.
			c.setStrokeColor(outlineColor);
			c.setStrokeWidth(Math.max(0.75, Math.min(sw * 0.3, 1.2)));
			this.paintEndPlug(c, pts[1], pts[0], kind, len, duplex, col);
			this.paintEndPlug(c, pts[pts.length - 2], pts[pts.length - 1], kind, len,
				duplex, col);
		}
	};

	// The plug's tip sits on the end point, its boot back along the segment.
	mxShapeOliabakCable.prototype.paintEndPlug = function(c, from, to, kind, len,
		duplex, col)
	{
		if (from == null || to == null)
		{
			return;
		}

		var dx = to.x - from.x, dy = to.y - from.y;
		var d = Math.sqrt(dx * dx + dy * dy);

		if (d < 0.01)
		{
			return;
		}

		var angle = Math.atan2(dy, dx) * 180 / Math.PI;
		var h = len * 0.55;
		var lanes = duplex ? 2 : 1;
		var laneH = duplex ? h * 0.6 : h;

		for (var i = 0; i < lanes; i++)
		{
			var off = duplex ? (i == 0 ? -laneH * 0.5 : laneH * 0.5) : 0;
			c.save();
			c.translate(to.x, to.y);
			c.rotate(angle, false, false, 0, 0);
			c.translate(-len, off);
			paintPlug(c, kind, len, laneH, 1, col, 0.3, true);
			c.restore();
		}
	};

	mxCellRenderer.registerShape('mxgraph.oliabak.conn.cable', mxShapeOliabakCable);

	// ---------------------------------------------------------------------
	// Port
	// ---------------------------------------------------------------------

	/**
	 * A socket seen from the front, or a row of them. Meant for drawing a
	 * device face or a port map next to a cable.
	 */
	function mxShapeOliabakPort(bounds, fill, stroke, strokewidth)
	{
		init(this, bounds, fill, stroke, strokewidth);
	};

	mxUtils.extend(mxShapeOliabakPort, mxShape);

	var PORT_KINDS = [{val: 'rj45', dispName: 'RJ45'}, {val: 'sfp', dispName: 'SFP cage'},
		{val: 'qsfp', dispName: 'QSFP cage'}, {val: 'lc', dispName: 'LC duplex'},
		{val: 'sc', dispName: 'SC duplex'}, {val: 'mpo', dispName: 'MPO / MTP'},
		{val: 'bnc', dispName: 'BNC / F-type'}];

	mxShapeOliabakPort.prototype.customProperties = [
		{name: 'kind', dispName: 'Port', type: 'enum', defVal: 'rj45', enumList: PORT_KINDS},
		{name: 'ports', dispName: 'Ports', type: 'int', min: 1, max: 48, defVal: 1},
		{name: 'rows', dispName: 'Rows', type: 'int', min: 1, max: 4, defVal: 1},
		{name: 'leds', dispName: 'LEDs per Port', type: 'int', min: 0, max: 2, defVal: 2},
		{name: 'gap', dispName: 'Gap', type: 'float', min: 0, max: 0.5, defVal: 0.12},
		MARKING_PROP
	];

	mxShapeOliabakPort.prototype.paintVertexShape = function(c, x, y, w, h)
	{
		if (!(w > 0) || !(h > 0))
		{
			return;
		}

		var st = this.style;
		var col = colors(this);
		var kind = mxUtils.getValue(st, 'kind', 'rj45');
		var n = Math.round(num(st, 'ports', 1, 1, 48));
		var rows = Math.round(num(st, 'rows', 1, 1, 4));
		var leds = Math.round(num(st, 'leds', 2, 0, 2));
		var gap = num(st, 'gap', 0.12, 0, 0.5);
		var perRow = Math.ceil(n / rows);

		c.translate(x, y);
		paintPortGrid(c, kind, 0, 0, w, h, perRow, rows, n, gap, leds, col);
	};

	// How tall each socket is for its width, so a port never stretches to
	// fill a box that is taller than it is wide.
	var PORT_ASPECT = {rj45: 0.95, sfp: 0.5, qsfp: 0.48, lc: 0.72, sc: 0.8, mpo: 0.6,
		bnc: 1, ftype: 1};

	// Lays n ports of one kind into a box, LEDs leaving room above each row.
	// A row taller than its ports need centres them and keeps their shape.
	function paintPortGrid(c, kind, x, y, w, h, perRow, rows, n, gap, leds, col)
	{
		var ledRoom = (leds > 0) ? 0.28 : 0;
		var cellW = w / (perRow + gap * (perRow - 1));
		var cellH = h / rows;
		var portH = Math.min(cellH / (1 + ledRoom), cellW * (PORT_ASPECT[kind] || 0.8));
		var slack = cellH - portH * (1 + ledRoom);
		var k = 0;

		for (var r = 0; r < rows && k < n; r++)
		{
			for (var i = 0; i < perRow && k < n; i++, k++)
			{
				var px = x + i * cellW * (1 + gap);
				var py = y + r * cellH + slack / 2 + portH * ledRoom;
				paintPortFace(c, kind, px, py, cellW, portH, col, leds);
			}
		}
	};

	mxCellRenderer.registerShape('mxgraph.oliabak.conn.port', mxShapeOliabakPort);

	// ---------------------------------------------------------------------
	// Network interface card
	// ---------------------------------------------------------------------

	/**
	 * An add-in card drawn flat: the board, its edge connector, and the
	 * bracket on the left carrying the ports face-on, as product icons do.
	 * OCP is the other form: no bracket, ports along the left edge, the
	 * connector at the right, and the pull tab in the marking colour.
	 */
	function mxShapeOliabakNic(bounds, fill, stroke, strokewidth)
	{
		init(this, bounds, fill, stroke, strokewidth);
	};

	mxUtils.extend(mxShapeOliabakNic, mxShape);

	mxShapeOliabakNic.prototype.customProperties = [
		{name: 'form', dispName: 'Form', type: 'enum', defVal: 'pcie',
			enumList: [{val: 'pcie', dispName: 'PCIe'}, {val: 'ocp', dispName: 'OCP 3.0'}]},
		{name: 'ports', dispName: 'Ports', type: 'int', min: 1, max: 4, defVal: 2},
		{name: 'portKind', dispName: 'Port', type: 'enum', defVal: 'rj45',
			enumList: PORT_KINDS.slice(0, 4)},
		{name: 'bracket', dispName: 'Bracket Width', type: 'float', min: 0.1,
			max: 0.4, defVal: 0.2},
		{name: 'boardHeight', dispName: 'Board Height', type: 'float', min: 0.3,
			max: 0.9, defVal: 0.62},
		{name: 'chips', dispName: 'Chips', type: 'int', min: 0, max: 3, defVal: 1},
		{name: 'leds', dispName: 'LEDs per Port', type: 'int', min: 0, max: 2, defVal: 2},
		MARKING_PROP
	];

	mxShapeOliabakNic.prototype.paintVertexShape = function(c, x, y, w, h)
	{
		if (!(w > 0) || !(h > 0))
		{
			return;
		}

		var st = this.style;
		var col = colors(this);
		var ocp = mxUtils.getValue(st, 'form', 'pcie') == 'ocp';
		var n = Math.round(num(st, 'ports', 2, 1, 4));
		var kind = mxUtils.getValue(st, 'portKind', 'rj45');
		var bw = w * num(st, 'bracket', 0.2, 0.1, 0.4);
		var bh = h * num(st, 'boardHeight', 0.62, 0.3, 0.9);
		var chips = Math.round(num(st, 'chips', 1, 0, 3));
		var leds = Math.round(num(st, 'leds', 2, 0, 2));
		var r = Math.min(w, h) * 0.04;
		var pcb = shade(col.body, -0.12);
		var fingers = shade(col.body, -0.45);

		c.translate(x, y);

		if (!ocp)
		{
			// Board, with the edge connector below it.
			var boardX = bw, boardY = h * 0.08;
			c.setFillColor(pcb);
			c.begin();
			c.roundrect(boardX, boardY, w - boardX, bh, r, r);
			c.fillAndStroke();
			paintFingers(c, boardX + (w - boardX) * 0.1, boardY + bh, (w - boardX) * 0.55,
				h * 0.1, fingers, col);
			paintChips(c, boardX + (w - boardX) * 0.3, boardY + bh * 0.18, (w - boardX) * 0.62,
				bh * 0.64, chips, col);

			// Bracket: full height, with the hook at the top and tab at the foot.
			c.setFillColor(col.body);
			c.begin();
			c.moveTo(0, h * 0.04);
			c.lineTo(bw, h * 0.04);
			c.lineTo(bw, h * 0.96);
			c.lineTo(bw * 0.25, h * 0.96);
			c.lineTo(bw * 0.25, h);
			c.lineTo(0, h);
			c.close();
			c.fillAndStroke();
			paintPortGrid(c, kind, bw * 0.12, h * 0.12, bw * 0.76, h * 0.76, 1, n, n,
				0.15, leds, col);
		}
		else
		{
			// OCP: a low wide board, faceplate at the left, connector at the right.
			var faceW = bw;
			var boardY = h * 0.12;
			c.setFillColor(pcb);
			c.begin();
			c.roundrect(faceW * 0.8, boardY, w - faceW * 0.8 - w * 0.06, h - boardY * 2, r, r);
			c.fillAndStroke();
			c.setFillColor(fingers);
			c.begin();
			c.rect(w - w * 0.06, boardY + h * 0.1, w * 0.06, h - boardY * 2 - h * 0.2);
			c.fillAndStroke();
			paintChips(c, faceW + (w - faceW) * 0.2, boardY + h * 0.12, (w - faceW) * 0.5,
				h - boardY * 2 - h * 0.24, chips, col);
			c.setFillColor(col.body);
			c.begin();
			c.roundrect(0, 0, faceW, h, r, r);
			c.fillAndStroke();
			paintPortGrid(c, kind, faceW * 0.12, h * 0.1, faceW * 0.76, h * 0.62, 1, n, n,
				0.15, leds, col);
			// Pull tab.
			c.setFillColor(col.mark);
			c.begin();
			c.roundrect(faceW * 0.2, h * 0.8, faceW * 0.6, h * 0.12, r, r);
			c.fillAndStroke();
		}
	};

	function paintFingers(c, x, y, w, h, color, col)
	{
		c.setFillColor(color);
		c.begin();
		c.rect(x, y, w, h);
		c.fillAndStroke();
		c.setStrokeColor(shade(col.body, 0.4));
		c.setStrokeWidth(c.state.strokeWidth * 0.5);
		c.begin();
		var n = Math.max(4, Math.round(w / 6));

		for (var i = 1; i < n; i++)
		{
			c.moveTo(x + w * i / n, y);
			c.lineTo(x + w * i / n, y + h);
		}

		c.stroke();
		c.setStrokeWidth(c.state.strokeWidth * 2);
		c.setStrokeColor(col.line);
	};

	function paintChips(c, x, y, w, h, n, col)
	{
		if (n <= 0)
		{
			return;
		}

		c.setFillColor(shade(col.body, -0.55));
		var s = Math.min(h, w / (n * 1.4));

		for (var i = 0; i < n; i++)
		{
			var cx = x + (w / n) * (i + 0.5) - s / 2;
			c.begin();
			c.rect(cx, y + (h - s) / 2, s, s);
			c.fillAndStroke();
		}

		c.setFillColor(col.body);
	};

	mxCellRenderer.registerShape('mxgraph.oliabak.conn.nic', mxShapeOliabakNic);

	// ---------------------------------------------------------------------
	// Patch panel
	// ---------------------------------------------------------------------

	/**
	 * A rack patch panel from the front: ears, a label strip, and rows of
	 * ports grouped with a small gap every 'group' ports.
	 */
	function mxShapeOliabakPatchPanel(bounds, fill, stroke, strokewidth)
	{
		init(this, bounds, fill, stroke, strokewidth);
	};

	mxUtils.extend(mxShapeOliabakPatchPanel, mxShape);

	mxShapeOliabakPatchPanel.prototype.customProperties = [
		{name: 'kind', dispName: 'Port', type: 'enum', defVal: 'rj45',
			enumList: [{val: 'rj45', dispName: 'RJ45'}, {val: 'lc', dispName: 'LC duplex'},
				{val: 'sc', dispName: 'SC duplex'}, {val: 'mpo', dispName: 'MPO / MTP'}]},
		{name: 'ports', dispName: 'Ports', type: 'int', min: 1, max: 96, defVal: 24},
		{name: 'rows', dispName: 'Rows', type: 'int', min: 1, max: 4, defVal: 1},
		{name: 'group', dispName: 'Ports per Group', type: 'int', min: 0, max: 24, defVal: 6},
		{name: 'ears', dispName: 'Rack Ears', type: 'bool', defVal: true},
		{name: 'earWidth', dispName: 'Ear Width', type: 'float', min: 0.02, max: 0.15,
			defVal: 0.05},
		{name: 'labelStrip', dispName: 'Label Strip', type: 'bool', defVal: true},
		MARKING_PROP
	];

	mxShapeOliabakPatchPanel.prototype.paintVertexShape = function(c, x, y, w, h)
	{
		if (!(w > 0) || !(h > 0))
		{
			return;
		}

		var st = this.style;
		var col = colors(this);
		var kind = mxUtils.getValue(st, 'kind', 'rj45');
		var n = Math.round(num(st, 'ports', 24, 1, 96));
		var rows = Math.round(num(st, 'rows', 1, 1, 4));
		var group = Math.round(num(st, 'group', 6, 0, 24));
		var ears = bool(st, 'ears', true);
		var ew = ears ? w * num(st, 'earWidth', 0.05, 0.02, 0.15) : 0;
		var strip = bool(st, 'labelStrip', true);
		var r = Math.min(w, h) * 0.05;

		c.translate(x, y);

		if (ears)
		{
			c.setFillColor(shade(col.body, -0.2));
			c.begin();
			c.rect(0, 0, w, h);
			c.fillAndStroke();
			// Mounting holes.
			c.setFillColor(shade(col.body, -0.7));
			var d = Math.min(ew * 0.45, h * 0.18);
			var xs = [ew / 2 - d / 2, w - ew / 2 - d / 2];

			for (var i = 0; i < 2; i++)
			{
				c.begin();
				c.ellipse(xs[i], h * 0.2 - d / 2, d, d);
				c.fill();
				c.begin();
				c.ellipse(xs[i], h * 0.8 - d / 2, d, d);
				c.fill();
			}
		}

		// Face plate.
		var fx = ew, fw = w - 2 * ew;
		c.setFillColor(col.body);
		c.begin();
		c.roundrect(fx, 0, fw, h, r, r);
		c.fillAndStroke();

		var top = h * 0.08;
		var inset = fw * 0.03;

		if (strip)
		{
			// Label strip with a marking tick at the head of each group.
			var sh = h * 0.16;
			c.setFillColor(shade(col.body, 0.5));
			c.begin();
			c.rect(fx + inset, top, fw - 2 * inset, sh);
			c.fillAndStroke();
			top += sh + h * 0.06;
		}

		// Ports, grouped: the gap between groups is a whole extra gap.
		var perRow = Math.ceil(n / rows);
		var gap = 0.12;
		var groups = (group > 0) ? Math.ceil(perRow / group) : 1;
		var units = perRow + gap * (perRow - 1) + (groups - 1) * gap * 3;
		var cellW = (fw - 2 * inset) / units;
		var rowH = (h - top - h * 0.08) / rows;
		var portH = rowH * 0.86;
		var k = 0;

		for (var rr = 0; rr < rows && k < n; rr++)
		{
			var px = fx + inset;

			for (var i = 0; i < perRow && k < n; i++, k++)
			{
				if (group > 0 && i > 0 && i % group == 0)
				{
					px += cellW * gap * 3;
				}

				paintPortFace(c, kind, px, top + rr * rowH + (rowH - portH) / 2, cellW,
					portH, col, 0);
				px += cellW * (1 + gap);
			}
		}

		if (strip)
		{
			c.setFillColor(col.mark);
			var px = fx + inset;
			var th = h * 0.16;

			for (var i = 0; i < perRow; i++)
			{
				if (group > 0 && i > 0 && i % group == 0)
				{
					px += cellW * gap * 3;
				}

				if (group == 0 ? i == 0 : i % group == 0)
				{
					c.begin();
					c.rect(px, h * 0.08, cellW * 0.25, th);
					c.fill();
				}

				px += cellW * (1 + gap);
			}
		}
	};

	mxCellRenderer.registerShape('mxgraph.oliabak.conn.patchPanel',
		mxShapeOliabakPatchPanel);

	// ---------------------------------------------------------------------
	// Media converter
	// ---------------------------------------------------------------------

	/**
	 * A small box with copper on one side and fibre on the other, seen from
	 * above with both faces folded up so the ports show.
	 */
	function mxShapeOliabakMediaConverter(bounds, fill, stroke, strokewidth)
	{
		init(this, bounds, fill, stroke, strokewidth);
	};

	mxUtils.extend(mxShapeOliabakMediaConverter, mxShape);

	mxShapeOliabakMediaConverter.prototype.customProperties = [
		{name: 'copperPorts', dispName: 'Copper Ports', type: 'int', min: 0, max: 4, defVal: 1},
		{name: 'fiberKind', dispName: 'Fibre Port', type: 'enum', defVal: 'sfp',
			enumList: [{val: 'sfp', dispName: 'SFP cage'}, {val: 'lc', dispName: 'LC duplex'},
				{val: 'sc', dispName: 'SC duplex'}]},
		{name: 'fiberPorts', dispName: 'Fibre Ports', type: 'int', min: 0, max: 4, defVal: 1},
		{name: 'leds', dispName: 'Status LEDs', type: 'int', min: 0, max: 8, defVal: 4},
		{name: 'faceDepth', dispName: 'Face Depth', type: 'float', min: 0.12, max: 0.4,
			defVal: 0.24},
		MARKING_PROP
	];

	mxShapeOliabakMediaConverter.prototype.paintVertexShape = function(c, x, y, w, h)
	{
		if (!(w > 0) || !(h > 0))
		{
			return;
		}

		var st = this.style;
		var col = colors(this);
		var cu = Math.round(num(st, 'copperPorts', 1, 0, 4));
		var fk = mxUtils.getValue(st, 'fiberKind', 'sfp');
		var fi = Math.round(num(st, 'fiberPorts', 1, 0, 4));
		var leds = Math.round(num(st, 'leds', 4, 0, 8));
		var fd = w * num(st, 'faceDepth', 0.24, 0.12, 0.4);
		var r = Math.min(w, h) * 0.08;

		c.translate(x, y);
		c.setFillColor(col.body);
		c.begin();
		c.roundrect(0, 0, w, h, r, r);
		c.fillAndStroke();

		// The two faces, darker, ports laid down each.
		c.setFillColor(shade(col.body, -0.25));
		c.begin();
		c.roundrect(0, 0, fd, h, r, r);
		c.fillAndStroke();
		c.begin();
		c.roundrect(w - fd, 0, fd, h, r, r);
		c.fillAndStroke();

		if (cu > 0)
		{
			paintPortGrid(c, 'rj45', fd * 0.15, h * 0.12, fd * 0.7, h * 0.76, 1, cu, cu,
				0.2, 0, col);
		}

		if (fi > 0)
		{
			paintPortGrid(c, fk, w - fd + fd * 0.15, h * 0.12, fd * 0.7, h * 0.76, 1, fi, fi,
				0.2, 0, col);
		}

		// Status LEDs across the lid.
		if (leds > 0)
		{
			c.setFillColor(col.mark);
			var span = w - 2 * fd;
			var d = Math.min(h * 0.14, span / (leds * 2.2));

			for (var i = 0; i < leds; i++)
			{
				var lx = fd + span * (i + 0.5) / leds - d / 2;
				c.begin();
				c.ellipse(lx, h * 0.5 - d / 2, d, d);
				c.fill();
			}
		}
	};

	mxCellRenderer.registerShape('mxgraph.oliabak.conn.mediaConverter',
		mxShapeOliabakMediaConverter);

	// ---------------------------------------------------------------------
	// Coupler
	// ---------------------------------------------------------------------

	/**
	 * A bulkhead adapter or keystone: a body with a mounting flange in the
	 * middle and a bore at each end, dust caps in the marking colour.
	 */
	function mxShapeOliabakCoupler(bounds, fill, stroke, strokewidth)
	{
		init(this, bounds, fill, stroke, strokewidth);
	};

	mxUtils.extend(mxShapeOliabakCoupler, mxShape);

	mxShapeOliabakCoupler.prototype.customProperties = [
		{name: 'kind', dispName: 'Coupler', type: 'enum', defVal: 'lc',
			enumList: [{val: 'lc', dispName: 'LC'}, {val: 'sc', dispName: 'SC'},
				{val: 'mpo', dispName: 'MPO / MTP'}, {val: 'rj45', dispName: 'RJ45 keystone'},
				{val: 'ftype', dispName: 'F-type barrel'}, {val: 'bnc', dispName: 'BNC barrel'}]},
		{name: 'duplex', dispName: 'Duplex', type: 'bool', defVal: true},
		{name: 'flange', dispName: 'Flange Width', type: 'float', min: 0.05, max: 0.4,
			defVal: 0.14},
		{name: 'caps', dispName: 'Dust Caps', type: 'bool', defVal: true},
		MARKING_PROP
	];

	mxShapeOliabakCoupler.prototype.paintVertexShape = function(c, x, y, w, h)
	{
		if (!(w > 0) || !(h > 0))
		{
			return;
		}

		var st = this.style;
		var col = colors(this);
		var kind = mxUtils.getValue(st, 'kind', 'lc');
		var duplex = bool(st, 'duplex', true) && (kind == 'lc' || kind == 'sc');
		var fw = w * num(st, 'flange', 0.14, 0.05, 0.4);
		var caps = bool(st, 'caps', true);
		var round = (kind == 'ftype' || kind == 'bnc');
		var r = Math.min(w, h) * (round ? 0.35 : 0.08);
		var lanes = duplex ? 2 : 1;
		var laneH = h / lanes;

		c.translate(x, y);

		for (var i = 0; i < lanes; i++)
		{
			var top = i * laneH + laneH * 0.14;
			var bh = laneH * 0.72;
			c.setFillColor(col.body);
			c.begin();
			c.roundrect(0, top, w, bh, r, r);
			c.fillAndStroke();

			// Bores at both ends, or caps over them.
			var boreW = w * 0.14, boreH = bh * 0.5;
			c.setFillColor(caps ? col.mark : shade(col.body, -0.75));
			c.begin();
			c.roundrect(w * 0.04, top + (bh - boreH) / 2, boreW, boreH, r * 0.3, r * 0.3);
			c.fillAndStroke();
			c.begin();
			c.roundrect(w - w * 0.04 - boreW, top + (bh - boreH) / 2, boreW, boreH,
				r * 0.3, r * 0.3);
			c.fillAndStroke();
		}

		// Flange over everything, full height.
		c.setFillColor(shade(col.body, -0.3));
		c.begin();
		c.rect(w / 2 - fw / 2, 0, fw, h);
		c.fillAndStroke();

		if (kind == 'rj45')
		{
			// Keystone latch in the marking colour.
			c.setFillColor(col.mark);
			c.begin();
			c.rect(w / 2 - fw * 0.3, 0, fw * 0.6, h * 0.14);
			c.fillAndStroke();
		}
	};

	mxCellRenderer.registerShape('mxgraph.oliabak.conn.coupler', mxShapeOliabakCoupler);

	// ---------------------------------------------------------------------
	// Handles
	// ---------------------------------------------------------------------

	if (typeof Graph !== 'undefined' && Graph.handleFactory != null &&
		typeof Graph.createHandle === 'function')
	{
		// A handle that slides along one edge of the cell and stores where it
		// sits as a share of the width (axis 'x') or height (axis 'y').
		function shareHandle(state, key, axis, min, max, dflt, edge)
		{
			return Graph.createHandle(state, [key], function(bounds)
			{
				var v = num(state.style, key, dflt, min, max);

				if (axis == 'x')
				{
					return new mxPoint(bounds.x + bounds.width * v,
						bounds.y + bounds.height * edge);
				}

				return new mxPoint(bounds.x + bounds.width * edge,
					bounds.y + bounds.height * v);
			}, function(bounds, pt)
			{
				var v = (axis == 'x') ? (pt.x - bounds.x) / bounds.width :
					(pt.y - bounds.y) / bounds.height;
				state.style[key] = Math.round(Math.max(min, Math.min(max, v)) * 100) / 100;
			}, true);
		};

		// Port face depth, on the top edge.
		Graph.handleFactory['mxgraph.oliabak.conn.pluggable'] = function(state)
		{
			return [Graph.createHandle(state, ['faceDepth'], function(bounds)
			{
				var p = mxShapeOliabakPluggable.prototype.resolve(state.style);

				return new mxPoint(bounds.x + bounds.width * p.face, bounds.y);
			}, function(bounds, pt)
			{
				state.style['faceDepth'] = Math.round(Math.max(0.08, Math.min(0.5,
					(pt.x - bounds.x) / bounds.width)) * 100) / 100;
			}, true)];
		};

		// Boot length, on the bottom edge.
		Graph.handleFactory['mxgraph.oliabak.conn.connector'] = function(state)
		{
			return [shareHandle(state, 'bootLength', 'x', 0.1, 0.6, 0.32, 1)];
		};

		// Plug length on the top edge; sag on the jacket's lowest point.
		Graph.handleFactory['mxgraph.oliabak.conn.patchCable'] = function(state)
		{
			var proto = mxShapeOliabakPatchCable.prototype;

			return [shareHandle(state, 'plugLength', 'x', 0.08, 0.4, 0.2, 0),
				Graph.createHandle(state, ['sag'], function(bounds)
				{
					var p = proto.resolve(state.style);
					var cy = proto.centreLine(p, bounds.height);

					return new mxPoint(bounds.x + bounds.width / 2,
						bounds.y + cy + p.sag * bounds.height * 0.675);
				}, function(bounds, pt)
				{
					// cy + 0.675 sag h = pt.y, with cy itself a function of sag.
					var v = (pt.y - bounds.y - bounds.height * 0.5) / (bounds.height * 0.475);
					state.style['sag'] = Math.round(Math.max(-1, Math.min(1, v)) * 100) / 100;
				}, true)];
		};

		// Plug length, on the target end, dragged back along the last segment.
		Graph.handleFactory['mxgraph.oliabak.conn.cable'] = function(state)
		{
			if (mxUtils.getValue(state.style, 'plugs', 'none') == 'none')
			{
				return null;
			}

			var endInfo = function()
			{
				var pts = state.absolutePoints;

				if (pts == null || pts.length < 2 || pts[pts.length - 1] == null ||
					pts[pts.length - 2] == null)
				{
					return null;
				}

				var pe = pts[pts.length - 1], p0 = pts[pts.length - 2];
				var dx = pe.x - p0.x, dy = pe.y - p0.y;
				var d = Math.sqrt(dx * dx + dy * dy);

				return (d < 1) ? null : {pe: pe, ux: dx / d, uy: dy / d};
			};

			return [Graph.createHandle(state, ['plugSize'], function(bounds)
			{
				var e = endInfo();

				if (e == null)
				{
					return null;
				}

				var s = state.view.scale, tr = state.view.translate;
				var len = num(state.style, 'plugSize', 18, 4, 80) * s;

				return new mxPoint((e.pe.x - e.ux * len) / s - tr.x,
					(e.pe.y - e.uy * len) / s - tr.y);
			}, function(bounds, pt)
			{
				var e = endInfo();

				if (e == null)
				{
					return;
				}

				var s = state.view.scale, tr = state.view.translate;
				var px = (pt.x + tr.x) * s - e.pe.x;
				var py = (pt.y + tr.y) * s - e.pe.y;
				var len = -(px * e.ux + py * e.uy) / s;
				state.style['plugSize'] = Math.round(Math.max(4, Math.min(80, len)));
			}, true)];
		};

		// Gap between ports, on the bottom edge.
		Graph.handleFactory['mxgraph.oliabak.conn.port'] = function(state)
		{
			return [shareHandle(state, 'gap', 'x', 0, 0.5, 0.12, 1)];
		};

		// Bracket width on the top edge; board height on the left edge.
		Graph.handleFactory['mxgraph.oliabak.conn.nic'] = function(state)
		{
			return [shareHandle(state, 'bracket', 'x', 0.1, 0.4, 0.2, 0),
				shareHandle(state, 'boardHeight', 'y', 0.3, 0.9, 0.62, 1)];
		};

		// Ear width, on the top edge.
		Graph.handleFactory['mxgraph.oliabak.conn.patchPanel'] = function(state)
		{
			return [shareHandle(state, 'earWidth', 'x', 0.02, 0.15, 0.05, 0)];
		};

		// Face depth, on the top edge.
		Graph.handleFactory['mxgraph.oliabak.conn.mediaConverter'] = function(state)
		{
			return [shareHandle(state, 'faceDepth', 'x', 0.12, 0.4, 0.24, 0)];
		};

		// Flange width: the handle sits on the flange's right edge.
		Graph.handleFactory['mxgraph.oliabak.conn.coupler'] = function(state)
		{
			return [Graph.createHandle(state, ['flange'], function(bounds)
			{
				var f = num(state.style, 'flange', 0.14, 0.05, 0.4);

				return new mxPoint(bounds.x + bounds.width * (0.5 + f / 2), bounds.y);
			}, function(bounds, pt)
			{
				var f = ((pt.x - bounds.x) / bounds.width - 0.5) * 2;
				state.style['flange'] = Math.round(Math.max(0.05, Math.min(0.4, f)) * 100) / 100;
			}, true)];
		};
	}
})();
