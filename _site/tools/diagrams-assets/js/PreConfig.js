/**
 * Copyright (c) 2006-2024, JGraph Holdings Ltd
 * Copyright (c) 2006-2024, draw.io AG
 *
 * Modified 2026-09-03 by Hossein Oliabak as part of Diagrams.
 * Changes from the original are licensed under the Apache License 2.0.
 * See NOTICE and CHANGES.md at the root of this distribution.
 */
// Overrides of global vars need to be pre-loaded
window.DRAWIO_PUBLIC_BUILD = true;

// Diagrams: same-origin export endpoint.
//
// This MUST stay truthy and MUST NOT be removed. js/diagramly/Init.js falls back
// to https://convert.diagrams.net/node/export when EXPORT_URL is unset, which
// would post diagram content to a third-party conversion server. Nothing is
// served at this path yet, so server-side export fails closed instead of
// leaking. Client-side export (PNG, SVG, XML, HTML) does not use this.
window.EXPORT_URL = '/tools/diagrams-assets/export';

window.DRAWIO_BASE_URL = null; // Replace with path to base of deployment, e.g. https://www.example.com/folder
window.DRAWIO_VIEWER_URL = null; // Replace your path to the viewer js, e.g. https://www.example.com/js/viewer.min.js
// Diagrams: upstream defaults this to https://viewer.diagrams.net in
// js/diagramly/Init.js when it is falsy, which would hand a diagram to a third
// party viewer. There is no hosted viewer for this build, so this points at a
// path that is not served: the lightbox link feature fails closed rather than
// publishing anything. Must stay truthy or the upstream default returns.
window.DRAWIO_LIGHTBOX_URL = '/tools/diagrams-assets/lightbox';

// Diagrams: Visio (.vsd/.vss) conversion. Upstream defaults this to
// https://convert.diagrams.net/VsdConverter/api/converter, which uploads the
// user's file to a third-party server. Pointed at a same-origin path that is
// not served, so the feature fails closed rather than transmitting the file.
window.VSS_CONVERT_URL = '/tools/diagrams-assets/vss-convert';
window.DRAW_MATH_URL = 'math4/es5';
window.DRAWIO_CONFIG = null; // Replace with your custom draw.io configurations. For more details, https://www.drawio.com/doc/faq/configure-diagram-editor
urlParams['sync'] = 'manual';

// Diagrams: storage backends.
//
// Google Drive and GitHub are the two we keep. The rest are switched off here
// rather than by deleting files, so this fork stays cheap to rebase on upstream.
urlParams['db'] = '0'; // Dropbox
urlParams['od'] = '0'; // OneDrive / SharePoint
urlParams['gl'] = '0'; // GitLab
                       // Trello needs tr=1 to switch on, so it is already off.

// Diagrams: OAuth client IDs.
//
// These must be registered under this site's own accounts. Upstream's client IDs
// are locked to draw.io's domains and would not authorise this origin even if we
// used them, which we must not. See docs/oauth-setup.md.
window.DRAWIO_GOOGLE_CLIENT_ID = null; // TODO: Google Cloud OAuth 2.0 Web client ID
window.DRAWIO_GITHUB_ID = null;        // TODO: GitHub OAuth app client ID

// Until those exist, keep the backends that depend on them switched off, so the
// UI never offers a sign-in that cannot complete. Local device and browser
// storage are unaffected and remain fully functional.
if (window.DRAWIO_GOOGLE_CLIENT_ID == null)
{
	urlParams['gapi'] = '0';
}

if (window.DRAWIO_GITHUB_ID == null)
{
	urlParams['gh'] = '0';
}
