import { NavigationMode, ProjectionMode } from '../engine/viewer/camera.js';
import { RGBAColor, RGBColor } from '../engine/model/color.js';
import { EdgeSettings } from '../engine/viewer/viewermodel.js';
import { CookieGetBoolVal, CookieGetRGBColorVal, CookieGetIntVal, CookieGetStringVal, CookieSetBoolVal, CookieSetRGBColorVal, CookieSetIntVal, CookieSetStringVal, CookieSetRGBAColorVal, CookieGetRGBAColorVal } from './cookiehandler.js';
import { GetPreferredColorScheme } from './utils.js';

export const Theme =
{
    Light : 1,
    Dark : 2
};

export class Settings
{
    constructor (themeId)
    {
        this.themeId = Theme.Dark; // Always use Dark theme
        this.environmentMapName = 'fishermans_bastion';
        this.backgroundIsEnvMap = false;
        
        // Set a permanent custom background color #0F0F0F78 (rgba(15,15,15,120))
        this.backgroundColor = new RGBAColor (15, 15, 15, 120);
        this.defaultLineColor = new RGBColor (100, 100, 100);
        this.defaultColor = new RGBColor (200, 200, 200);
        
        this.edgeSettings = new EdgeSettings (false, new RGBColor (0, 0, 0), 1);
    }

    LoadFromCookies ()
    {
        // Do not load theme and background color from cookies
        // Keep the fixed values set in the constructor
        
        // Still load other settings from cookies
        this.environmentMapName = CookieGetStringVal ('ov_environment_map', 'fishermans_bastion');
        this.defaultLineColor = CookieGetRGBColorVal ('ov_default_line_color', new RGBColor (100, 100, 100));
        this.defaultColor = CookieGetRGBColorVal ('ov_default_color', new RGBColor (200, 200, 200));
        this.edgeSettings.showEdges = CookieGetBoolVal ('ov_show_edges', false);
        this.edgeSettings.edgeColor = CookieGetRGBColorVal ('ov_edge_color', new RGBColor (0, 0, 0));
        this.edgeSettings.edgeThreshold = CookieGetIntVal ('ov_edge_threshold', 1);
    }

    SaveToCookies ()
    {
        CookieSetIntVal ('ov_theme_id', this.themeId);
        CookieSetStringVal ('ov_environment_map', this.environmentMapName);
        CookieSetBoolVal ('ov_background_is_envmap', this.backgroundIsEnvMap);
        CookieSetRGBAColorVal ('ov_background_color', this.backgroundColor);
        CookieSetRGBColorVal ('ov_default_line_color', this.defaultLineColor);
        CookieSetRGBColorVal ('ov_default_color', this.defaultColor);
        CookieSetBoolVal ('ov_show_edges', this.edgeSettings.showEdges);
        CookieSetRGBColorVal ('ov_edge_color', this.edgeSettings.edgeColor);
        CookieSetIntVal ('ov_edge_threshold', this.edgeSettings.edgeThreshold);
    }
}

export class CameraSettings
{
    constructor ()
    {
        this.navigationMode = NavigationMode.FixedUpVector;
        this.projectionMode = ProjectionMode.Perspective;
    }

    LoadFromCookies ()
    {
        this.navigationMode = CookieGetIntVal ('ov_navigation_mode', NavigationMode.FixedUpVector);
        this.projectionMode = CookieGetIntVal ('ov_projection_mode', ProjectionMode.Perspective);
    }

    SaveToCookies ()
    {
        CookieSetIntVal ('ov_navigation_mode', this.navigationMode);
        CookieSetIntVal ('ov_projection_mode', this.projectionMode);
    }
}
