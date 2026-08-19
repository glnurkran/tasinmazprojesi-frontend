import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import OSM from 'ol/source/OSM';
import XYZ from 'ol/source/XYZ';
import { ScaleLine } from 'ol/control';
import TileLayer from 'ol/layer/Tile';

@Injectable({
  providedIn: 'root'
})
export class MapManagerService {
  private STORAGE_KEY = 'tasinmaz_map_settings';

  baseLayerType: 'osm' | 'google' = 'osm';
  vectorOpacity: number = 0.6; // default opacity
  baseLayerVisible: boolean = true;
  vectorLayerVisible: boolean = true;

  constructor() {
    this.loadSettings();
  }

  loadSettings(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const settings = JSON.parse(stored);
        if (settings.baseLayerType) this.baseLayerType = settings.baseLayerType;
        if (settings.vectorOpacity !== undefined) this.vectorOpacity = settings.vectorOpacity;
        if (settings.baseLayerVisible !== undefined) this.baseLayerVisible = settings.baseLayerVisible;
        if (settings.vectorLayerVisible !== undefined) this.vectorLayerVisible = settings.vectorLayerVisible;
      }
    } catch (e) {
      console.error('Failed to load map settings', e);
    }
  }

  saveSettings(): void {
    try {
      const settings = {
        baseLayerType: this.baseLayerType,
        vectorOpacity: this.vectorOpacity,
        baseLayerVisible: this.baseLayerVisible,
        vectorLayerVisible: this.vectorLayerVisible
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error('Failed to save map settings', e);
    }
  }

  hasGoogleMapsKey(): boolean {
    const key = environment.googleMapsApiKey;
    return !!(key && key !== 'AIzaSyYourApiKeyHere' && key.trim().length > 5);
  }

  createBaseSource(type: 'osm' | 'google'): any {
    if (type === 'google' && this.hasGoogleMapsKey()) {
      const key = environment.googleMapsApiKey;
      return new XYZ({
        url: `https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&key=${key}`,
        attributions: 'Map data &copy; Google'
      });
    } else if (type === 'google') {
      // Fallback if key is missing (renders public XYZ or OSM)
      return new XYZ({
        url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
        attributions: 'Map data &copy; Google'
      });
    }
    return new OSM();
  }

  applyMapSettings(map: any, baseLayer: TileLayer<any>, vectorLayer: any): void {
    if (!map) return;

    // Apply base source
    const currentSource = this.createBaseSource(this.baseLayerType);
    if (baseLayer) {
      baseLayer.setSource(currentSource);
      baseLayer.setVisible(this.baseLayerVisible);
    }

    // Apply visibility & opacity
    if (vectorLayer) {
      vectorLayer.setVisible(this.vectorLayerVisible);
      vectorLayer.setOpacity(this.vectorOpacity);
    }

    // Add scale control if not present
    this.addScaleLineControl(map);
  }

  addScaleLineControl(map: any): void {
    if (!map) return;
    
    // Check if ScaleLine already exists
    let hasScale = false;
    map.getControls().forEach((control: any) => {
      if (control instanceof ScaleLine) {
        hasScale = true;
      }
    });

    if (!hasScale) {
      const scaleLine = new ScaleLine({
        units: 'metric',
        bar: false,
        steps: 4,
        text: true,
        minWidth: 64,
        className: 'custom-scale-line'
      });
      map.addControl(scaleLine);
    }
  }
}
