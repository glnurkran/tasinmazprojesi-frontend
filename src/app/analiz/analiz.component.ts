import { Component, OnInit, AfterViewInit, OnDestroy, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { SpatialAnalysisService, GeometryRequestDto, GeometryResultDto, SpatialGeometry } from '../services/spatial-analysis.service';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import { fromLonLat, toLonLat } from 'ol/proj';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Geometry from 'ol/geom/Geometry';
import Draw from 'ol/interaction/Draw';
import Modify from 'ol/interaction/Modify';
import Collection from 'ol/Collection';
import GeoJSON from 'ol/format/GeoJSON';
import { Style, Fill, Stroke, Text } from 'ol/style';
import { getArea } from 'ol/sphere';
import { MapManagerService } from '../services/map-manager.service';
import { HttpErrorResponse } from '@angular/common/http';

interface RegionInfo {
  name: string;
  desc: string;
  area: string;
  color: string;
}

type GeometryStep = 'A' | 'B' | 'C';
type GeometryStatus = 'Bekliyor' | 'Çiziliyor' | 'Tamamlandı' | 'Kaydediliyor' | 'Kaydedildi' | 'Düzenleniyor' | 'Değiştirildi' | 'Geçersiz';

interface WorkspaceState {
  drawnGeometries: { A?: string; B?: string; C?: string };
  currentDrawStep: GeometryStep | 'COMPLETED';
  groupLabel: string;
  selectedGroup: string;
  dbIds: { A?: number; B?: number; C?: number };
  geometryStates: Record<GeometryStep, GeometryStatus>;
}

interface HistoryState {
  drawnGeometries: { A?: string; B?: string; C?: string };
  currentDrawStep: 'A' | 'B' | 'C' | 'COMPLETED';
  groupLabel: string;
  selectedGroup: string;
  dbIds: { A?: number; B?: number; C?: number };
  geometryStates: Record<GeometryStep, GeometryStatus>;
}

@Component({
  selector: 'app-analiz',
  templateUrl: './analiz.component.html',
  styleUrls: ['./analiz.component.scss']
})
export class AnalizComponent implements OnInit, AfterViewInit, OnDestroy {
  // Map and Layer Instances
  map: Map | null = null;
  baseLayer: TileLayer<any> | null = null;
  vectorSource = new VectorSource();
  vectorLayer: VectorLayer<any> | null = null;
  resultSource = new VectorSource();
  resultLayer: VectorLayer<any> | null = null;
  drawInteraction: Draw | null = null;
  modifyInteraction: Modify | null = null;
  showLayerPanel = false;

  // Selection & Operation State
  selectionMethod: 'manual' | 'auto' = 'manual';
  groupLabel: string = 'Yeni Analiz Grubu'; // Custom Label to save group
  selectedGroup: string = ''; // Selected Group Label in Auto selection mode
  selectedOperation: string = 'A_UNION_B'; // default operation

  // Active States
  isDrawingActive: boolean = false;
  isEditingActive: boolean = false;
  activeEditGeometry: 'A' | 'B' | 'C' | null = null;
  drawPointsCount: number = 0;

  // Drawn Geometries and Database IDs
  currentDrawStep: 'A' | 'B' | 'C' | 'COMPLETED' = 'A';
  drawnGeometries: { A?: string; B?: string; C?: string } = {};
  dbIds: { A?: number; B?: number; C?: number } = {};
  geometryStates: Record<GeometryStep, GeometryStatus> = this.createInitialGeometryStates();

  private workspaceStates: Record<'manual' | 'auto', WorkspaceState | null> = {
    manual: null,
    auto: null
  };
  private editBackup: { step: GeometryStep; geometry: string; status: GeometryStatus } | null = null;
  private redrawBackup: { step: GeometryStep; geometry: string; status: GeometryStatus } | null = null;

  // Undo/Redo Action History
  history: HistoryState[] = [];
  historyIndex: number = -1;

  // Loading/Computed States
  isComputing: boolean = false;
  isSaved: boolean = false;
  hasResult: boolean = false;

  // Loading & Tracking States
  isSaving: { A?: boolean; B?: boolean; C?: boolean } = {};
  isSavingGroup: boolean = false;
  geometriesChangedAfterAnalysis: boolean = false;

  // Analysis Outputs
  analysisResult: GeometryResultDto | null = null;
  constituentGeometries: RegionInfo[] = [];

  // Lists
  groupsList: string[] = [];

  // Miscellaneous UI Status
  hoverCoordinates: string = '39.9334° N, 32.8597° E'; // Default coordinate

  // Custom Modal State
  modalConfig = {
    isOpen: false,
    title: '',
    message: '',
    type: 'alert' as 'alert' | 'confirm' | 'error',
    resolve: null as any
  };

  showCustomAlert(title: string, message: string, type: 'alert' | 'confirm' | 'error' = 'alert'): Promise<boolean> {
    this.modalConfig.title = title;
    this.modalConfig.message = message;
    this.modalConfig.type = type;
    this.modalConfig.isOpen = true;
    return new Promise((resolve) => {
      this.modalConfig.resolve = resolve;
    });
  }

  private getSpatialErrorMessage(error: unknown, fallback: string): string {
    if (!(error instanceof HttpErrorResponse)) return fallback;

    if (error.status === 403) {
      return this.authService.isAdmin()
        ? 'Bu işlem için yetkiniz bulunmamaktadır.'
        : 'Mekansal analiz yetkiniz doğrulanamadı. Lütfen çıkış yapıp yeniden giriş yapın.';
    }

    if (error.status === 401) {
      return 'Oturumunuz geçersiz veya süresi dolmuş. Lütfen yeniden giriş yapın.';
    }

    if (typeof error.error === 'string' && error.error.trim() && !error.error.includes('Http failure response')) {
      return error.error;
    }

    if (error.error && typeof error.error.message === 'string') {
      return error.error.message;
    }

    return fallback;
  }

  closeCustomModal(result: boolean): void {
    this.modalConfig.isOpen = false;
    if (this.modalConfig.resolve) {
      this.modalConfig.resolve(result);
    }
  }

  private createInitialGeometryStates(): Record<GeometryStep, GeometryStatus> {
    return { A: 'Bekliyor', B: 'Bekliyor', C: 'Bekliyor' };
  }

  private readApiGeometry(geoJson: string): Geometry {
    return new GeoJSON().readGeometry(geoJson, {
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857'
    });
  }

  private writeApiGeometry(geometry: Geometry): string {
    return new GeoJSON().writeGeometry(geometry, {
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857'
    });
  }

  saveSingleGeometry(step: 'A' | 'B' | 'C'): void {
    if (!this.drawnGeometries[step]) {
      this.showCustomAlert('Hata', 'Kaydedilecek çizim bulunamadı.', 'error');
      return;
    }

    if (!this.groupLabel || this.groupLabel.trim() === '') {
      this.showCustomAlert('Hata', 'Lütfen geometri için bir grup etiket ismi giriniz.', 'error');
      return;
    }

    const payload = {
      label: this.groupLabel.trim(),
      geometry: this.drawnGeometries[step],
      operationType: step
    };

    const previousStatus = this.geometryStates[step];
    this.isSaving[step] = true;
    this.geometryStates[step] = 'Kaydediliyor';
    this.spatialAnalysisService.saveSingle(payload).subscribe({
      next: (res) => {
        this.isSaving[step] = false;
        this.dbIds[step] = res.data.id;
        this.geometryStates[step] = 'Kaydedildi';
        
        this.pushToHistory();
        this.loadGroups();
        this.showCustomAlert('Başarılı', `${step} Geometrisi başarıyla veritabanına kaydedildi.`, 'alert');
      },
      error: (err) => {
        this.isSaving[step] = false;
        this.geometryStates[step] = previousStatus;
        this.showCustomAlert('Hata', this.getSpatialErrorMessage(err, 'Geometri kaydedilirken bir hata oluştu.'), 'error');
      }
    });
  }

  saveGroupGeometries(): void {
    if (!this.groupLabel || !this.groupLabel.trim()) {
      this.showCustomAlert('Hata', 'Lütfen geçerli bir grup adı giriniz.', 'error');
      return;
    }

    if (!this.canSaveGroup()) {
      this.showCustomAlert('Hata', 'Grup kaydetmek için A, B ve C geometrilerinin tam dört köşeli ve tamamlanmış olması gerekir.', 'error');
      return;
    }

    const saveDto: GeometryRequestDto = {
      label: this.groupLabel.trim(),
      geometries: [this.drawnGeometries.A!, this.drawnGeometries.B!, this.drawnGeometries.C!],
      operationType: this.selectedOperation
    };

    const previousStates = { ...this.geometryStates };
    this.isSavingGroup = true;
    (['A', 'B', 'C'] as GeometryStep[]).forEach(step => this.geometryStates[step] = 'Kaydediliyor');
    this.spatialAnalysisService.saveGroup(saveDto).subscribe({
      next: (saveRes) => {
        this.isSavingGroup = false;
        if (saveRes.data && saveRes.data.length === 3) {
          this.dbIds.A = saveRes.data[0].id;
          this.dbIds.B = saveRes.data[1].id;
          this.dbIds.C = saveRes.data[2].id;
        }
        (['A', 'B', 'C'] as GeometryStep[]).forEach(step => this.geometryStates[step] = 'Kaydedildi');
        this.pushToHistory();
        this.loadGroups();
        this.showCustomAlert('Başarılı', 'Poligonlar başarıyla kaydedildi.', 'alert');
      },
      error: (err) => {
        this.isSavingGroup = false;
        this.geometryStates = previousStates;
        this.showCustomAlert('Hata', this.getSpatialErrorMessage(err, 'Geometri grubu kaydedilemedi.'), 'error');
      }
    });
  }

  getGeometryStatus(step: GeometryStep): GeometryStatus {
    return this.geometryStates[step];
  }

  canSaveGeometry(step: GeometryStep): boolean {
    return !!this.drawnGeometries[step]
      && !this.isSaving[step]
      && (this.geometryStates[step] === 'Tamamlandı' || this.geometryStates[step] === 'Değiştirildi');
  }

  canSaveGroup(): boolean {
    return this.selectionMethod === 'manual'
      && !!this.groupLabel.trim()
      && !this.isSavingGroup
      && !this.isDrawingActive
      && !this.isEditingActive
      && !(['A', 'B', 'C'] as GeometryStep[]).some(step => this.isSaving[step])
      && (['A', 'B', 'C'] as GeometryStep[]).every(step => this.isFourCornerGeometry(this.drawnGeometries[step]));
  }

  private isFourCornerGeometry(geoJson?: string): boolean {
    if (!geoJson) return false;
    try {
      const geometry = new GeoJSON().readGeometry(geoJson);
      const ring = (geometry as any).getCoordinates()?.[0];
      if (!Array.isArray(ring)) return false;
      const uniqueCoordinates: any[] = [];
      ring.forEach((coordinate: any) => {
        if (!uniqueCoordinates.some(existing => Math.abs(existing[0] - coordinate[0]) < 1e-7 && Math.abs(existing[1] - coordinate[1]) < 1e-7)) {
          uniqueCoordinates.push(coordinate);
        }
      });
      return uniqueCoordinates.length === 4;
    } catch {
      return false;
    }
  }

  onGeometryChange(): void {
    if (this.hasResult || this.analysisResult) {
      this.geometriesChangedAfterAnalysis = true;
      this.hasResult = false;
      this.analysisResult = null;
      // Remove result feature from map
      if (this.vectorSource) {
        this.resultSource.clear();
      }
    }
  }

  removeLastDrawnPoint(): void {
    if (this.drawInteraction) {
      this.drawInteraction.removeLastPoint();
    }
  }

  finishCurrentDrawing(): void {
    if (this.drawInteraction) {
      this.drawInteraction.finishDrawing();
    }
  }

  constructor(
    public authService: AuthService,
    private spatialAnalysisService: SpatialAnalysisService,
    private router: Router,
    public mapManager: MapManagerService
  ) {}

  ngOnInit(): void {
    this.resetWorkspace();
    this.loadGroups();
  }

  ngAfterViewInit(): void {
    this.initMap();
  }

  loadSavedGroupGeometries(label: string): void {
    this.vectorSource.clear();
    this.resultSource.clear();
    this.hasResult = false;
    this.analysisResult = null;
    this.drawnGeometries = {};
    this.dbIds = {};
    this.geometryStates = this.createInitialGeometryStates();
    this.constituentGeometries = [];

    this.spatialAnalysisService.getGroupGeometries(label).subscribe({
      next: (res) => {
        const format = new GeoJSON();
        let savedResultItem: any = null;

        res.forEach((item) => {
          const isResult = item.operationType === 'D' || item.operationType === 'E';
          const geom = format.readGeometry(item.geometry, {
            dataProjection: 'EPSG:4326',
            featureProjection: 'EPSG:3857'
          });
          const feature = new Feature({
            geometry: geom
          });
          feature.set('type', isResult ? 'RESULT' : item.operationType);
          (isResult ? this.resultSource : this.vectorSource).addFeature(feature);

          if (item.operationType === 'A') {
            this.drawnGeometries.A = item.geometry;
            this.dbIds.A = item.id;
            this.geometryStates.A = 'Kaydedildi';
          } else if (item.operationType === 'B') {
            this.drawnGeometries.B = item.geometry;
            this.dbIds.B = item.id;
            this.geometryStates.B = 'Kaydedildi';
          } else if (item.operationType === 'C') {
            this.drawnGeometries.C = item.geometry;
            this.dbIds.C = item.id;
            this.geometryStates.C = 'Kaydedildi';
          } else if (isResult) {
            savedResultItem = item;
          }
        });

        // Restore analysisResult and breakdown if savedResult exists
        if (savedResultItem) {
          const opTypeLabel = savedResultItem.operationType === 'D' ? 'D (A ∪ B)' : 'E (A ∪ B ∪ C)';
          this.analysisResult = {
            label: savedResultItem.label,
            operationType: savedResultItem.operationType === 'D' ? 'A_UNION_B' : 'A_UNION_B_UNION_C',
            operationLabel: opTypeLabel,
            resultGeometryGeoJson: savedResultItem.geometry,
            resultGeometryType: savedResultItem.geometry.indexOf('MultiPolygon') > -1 ? 'MultiPolygon' : 'Polygon',
            resultAreaM2: savedResultItem.areaSquareMeters,
            resultAreaHectare: savedResultItem.areaSquareMeters / 10000.0,
            hasResult: true,
            isPersisted: true,
            message: `${opTypeLabel} birleşimi başarıyla yüklendi.`,
            sourceGeometryIds: savedResultItem.sourceGeometryIds,
            createdAt: savedResultItem.createdAt
          };
          this.hasResult = true;

          let operationLabel = 'Sonuç Alanı';
          if (savedResultItem.operationType === 'D') {
            operationLabel = 'D (A ∪ B) Birleşim Alanı';
          } else if (savedResultItem.operationType === 'E') {
            operationLabel = 'E (A ∪ B ∪ C) Birleşim Alanı';
          }

          this.constituentGeometries = [
            { name: 'A Poligonu', desc: 'Analize katılan A geometrisi', area: this.getGeomAreaText(this.drawnGeometries.A), color: '#3b82f6' },
            { name: 'B Poligonu', desc: 'Analize katılan B geometrisi', area: this.getGeomAreaText(this.drawnGeometries.B), color: '#f59e0b' },
            { name: 'C Poligonu', desc: 'Analize katılan C geometrisi', area: this.getGeomAreaText(this.drawnGeometries.C), color: '#8b5cf6' },
            { name: operationLabel, desc: 'Analiz sonucu oluşan alan', area: this.formatNumber(savedResultItem.areaSquareMeters, 2) + ' m²', color: '#10b981' }
          ];
        } else if (this.drawnGeometries.A && this.drawnGeometries.B && this.drawnGeometries.C) {
          this.constituentGeometries = [
            { name: 'A Poligonu', desc: 'Analize katılan A geometrisi', area: this.getGeomAreaText(this.drawnGeometries.A), color: '#3b82f6' },
            { name: 'B Poligonu', desc: 'Analize katılan B geometrisi', area: this.getGeomAreaText(this.drawnGeometries.B), color: '#f59e0b' },
            { name: 'C Poligonu', desc: 'Analize katılan C geometrisi', area: this.getGeomAreaText(this.drawnGeometries.C), color: '#8b5cf6' }
          ];
        }

        this.currentDrawStep = 'COMPLETED';
        this.pushToHistory();
        this.resetMapView();
      },
      error: (err) => {
        console.error('Sayfa yuklenirken kayıtlı geometriler yuklenemedi:', err);
      }
    });
  }

  ngOnDestroy(): void {
    this.removeDrawInteraction();
    this.removeModifyInteraction();
    if (this.map) {
      this.map.setTarget(undefined);
      this.map = null;
    }
  }

  // Keyboard Shortcuts (Ctrl+Z, Ctrl+Y, Escape)
  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent): void {
    // If user is editing a text input or selection dropdown, do not trigger shortcuts
    const tagName = (event.target as HTMLElement).tagName;
    if (tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA') {
      return;
    }

    if (event.ctrlKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      this.undo();
    } else if (event.ctrlKey && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.redo();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelActiveOperation();
    }
  }

  initMap(): void {
    const el = document.getElementById('analiz-map');
    if (!el) {
      setTimeout(() => this.initMap(), 50);
      return;
    }

    this.vectorLayer = new VectorLayer({
      source: this.vectorSource,
      style: (feature: any) => this.getFeatureStyle(feature)
    });

    this.resultLayer = new VectorLayer({
      source: this.resultSource,
      style: (feature: any) => this.getFeatureStyle(feature),
      zIndex: 20
    });

    this.baseLayer = new TileLayer({
      source: this.mapManager.createBaseSource(this.mapManager.baseLayerType)
    });

    this.map = new Map({
      target: 'analiz-map',
      layers: [
        this.baseLayer,
        this.vectorLayer,
        this.resultLayer
      ],
      view: new View({
        center: fromLonLat([32.8597, 39.9334]), // Ankara
        zoom: 12,
        minZoom: 4,
        maxZoom: 19
      }),
      controls: []
    });

    // Apply settings from MapManager (Base map type, visibility, opacity, ScaleLine)
    this.mapManager.applyMapSettings(this.map, this.baseLayer, this.vectorLayer);

    // Pointer move listener for coordinates
    this.map.on('pointermove', (evt) => {
      if (evt.coordinate) {
        const lonLat = toLonLat(evt.coordinate);
        const lat = lonLat[1].toFixed(4);
        const lng = lonLat[0].toFixed(4);
        this.hoverCoordinates = `${lat}° N, ${lng}° E`;
      }
    });

    // Click listener to show clicked polygon's area
    this.map.on('singleclick', (evt) => {
      if (this.isDrawingActive || this.isEditingActive) return;
      
      const feature = this.map?.forEachFeatureAtPixel(evt.pixel, (f) => f);
      if (feature) {
        const type = feature.get('type');
        if (type === 'A' || type === 'B' || type === 'C') {
          const geom = feature.getGeometry();
          if (geom) {
            const geoJsonStr = this.writeApiGeometry(geom as Geometry);
            const areaText = this.getGeomAreaText(geoJsonStr);
            this.showCustomAlert(`${type} Poligon Alanı`, `Seçilen ${type} poligonunun alanı: ${areaText}`, 'alert');
          }
        } else if (type === 'RESULT') {
          const label = this.analysisResult ? this.analysisResult.operationLabel : 'Sonuç Alanı';
          const geom = feature.getGeometry();
          if (geom) {
            const geoJsonStr = this.writeApiGeometry(geom as Geometry);
            const areaText = this.getGeomAreaText(geoJsonStr);
            this.showCustomAlert(label, `Analiz sonucu oluşan alan: ${areaText}`, 'alert');
          }
        }
      }
    });

    // Push initial empty state to history
    this.pushToHistory();
  }

  // Undo/Redo Implementation
  pushToHistory(): void {
    // If we performed new actions after an undo, clear the redo history
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }

    this.history.push({
      drawnGeometries: { ...this.drawnGeometries },
      currentDrawStep: this.currentDrawStep,
      groupLabel: this.groupLabel,
      selectedGroup: this.selectedGroup,
      dbIds: { ...this.dbIds },
      geometryStates: { ...this.geometryStates }
    });
    this.historyIndex++;
  }

  undo(): void {
    if (this.isDrawingActive && this.drawInteraction) {
      this.drawInteraction.removeLastPoint();
      return;
    }

    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.restoreHistoryState(this.history[this.historyIndex]);
    }
  }

  redo(): void {
    if (this.isDrawingActive || this.isEditingActive) return;

    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.restoreHistoryState(this.history[this.historyIndex]);
    }
  }

  restoreHistoryState(state: HistoryState): void {
    this.drawnGeometries = { ...state.drawnGeometries };
    this.currentDrawStep = state.currentDrawStep;
    this.groupLabel = state.groupLabel;
    this.selectedGroup = state.selectedGroup;
    this.dbIds = { ...state.dbIds };
    this.geometryStates = { ...state.geometryStates };

    this.vectorSource.clear();
    this.resultSource.clear();

    if (this.drawnGeometries.A) {
      const f = new Feature({ geometry: this.readApiGeometry(this.drawnGeometries.A) });
      f.set('type', 'A');
      this.vectorSource.addFeature(f);
    }
    if (this.drawnGeometries.B) {
      const f = new Feature({ geometry: this.readApiGeometry(this.drawnGeometries.B) });
      f.set('type', 'B');
      this.vectorSource.addFeature(f);
    }
    if (this.drawnGeometries.C) {
      const f = new Feature({ geometry: this.readApiGeometry(this.drawnGeometries.C) });
      f.set('type', 'C');
      this.vectorSource.addFeature(f);
    }

    this.hasResult = false;
    this.analysisResult = null;
  }

  // Load Groups List from Backend
  loadGroups(): void {
    this.spatialAnalysisService.getGroups().subscribe({
      next: (res) => {
        this.groupsList = res;
      },
      error: (err) => {
        console.error('Gruplar yuklenirken hata oluştu:', err);
      }
    });
  }

  // Change Selection Method
  setSelectionMethod(method: 'manual' | 'auto'): void {
    if (method === this.selectionMethod) return;

    this.cancelActiveOperation();
    this.workspaceStates[this.selectionMethod] = this.captureWorkspaceState();
    this.selectionMethod = method;
    this.restoreWorkspace(this.workspaceStates[method]);
  }

  private captureWorkspaceState(): WorkspaceState {
    return {
      drawnGeometries: { ...this.drawnGeometries },
      currentDrawStep: this.currentDrawStep,
      groupLabel: this.groupLabel,
      selectedGroup: this.selectedGroup,
      dbIds: { ...this.dbIds },
      geometryStates: { ...this.geometryStates }
    };
  }

  private restoreWorkspace(state: WorkspaceState | null): void {
    this.removeDrawInteraction();
    this.removeModifyInteraction();
    this.vectorSource.clear();
    this.resultSource.clear();
    this.drawnGeometries = state ? { ...state.drawnGeometries } : {};
    this.dbIds = state ? { ...state.dbIds } : {};
    this.geometryStates = state ? { ...state.geometryStates } : this.createInitialGeometryStates();
    this.currentDrawStep = state?.currentDrawStep ?? 'A';
    this.groupLabel = state?.groupLabel ?? 'Yeni Analiz Grubu';
    this.selectedGroup = state?.selectedGroup ?? '';
    this.hasResult = false;
    this.analysisResult = null;
    this.constituentGeometries = [];
    this.geometriesChangedAfterAnalysis = false;
    this.rebuildGeometryFeatures();
  }

  private rebuildGeometryFeatures(): void {
    (['A', 'B', 'C'] as GeometryStep[]).forEach(step => {
      const geometry = this.drawnGeometries[step];
      if (!geometry) return;
      const feature = new Feature({ geometry: this.readApiGeometry(geometry) });
      feature.set('type', step);
      this.vectorSource.addFeature(feature);
    });
  }

  setOperation(op: string): void {
    this.selectedOperation = op;
  }

  // Custom Zoom Controls
  zoomIn(): void {
    if (!this.map) return;
    const view = this.map.getView();
    const zoom = view.getZoom();
    if (zoom !== undefined) view.animate({ zoom: zoom + 1, duration: 200 });
  }

  zoomOut(): void {
    if (!this.map) return;
    const view = this.map.getView();
    const zoom = view.getZoom();
    if (zoom !== undefined) view.animate({ zoom: zoom - 1, duration: 200 });
  }

  goToDefaultLocation(): void {
    if (!this.map) return;
    this.map.getView().animate({
      center: fromLonLat([32.8597, 39.9334]),
      zoom: 12,
      duration: 300
    });
  }

  resetMapView(): void {
    if (!this.map) return;
    const extent = this.getVisibleGeometryExtent();
    if (!extent) return;
    this.map.getView().fit(extent, {
      padding: [70, 70, 70, 70],
      duration: 400,
      maxZoom: 16
    });
  }

  private fitAnalysisResult(): void {
    if (!this.map || this.resultSource.isEmpty()) return;
    const resultExtent = this.resultSource.getExtent();
    if (!this.isValidMapExtent(resultExtent)) return;
    const extent = this.getVisibleGeometryExtent();
    if (!extent) return;
    this.map.getView().fit(extent, {
      padding: [80, 80, 80, 80],
      duration: 450,
      maxZoom: 16
    });
  }

  private getVisibleGeometryExtent(): number[] | null {
    let combined: number[] | null = null;
    [this.vectorSource, this.resultSource].forEach(source => {
      if (source.isEmpty()) return;
      const extent = source.getExtent();
      if (!this.isValidMapExtent(extent)) return;
      combined = combined
        ? [
            Math.min(combined[0], extent[0]),
            Math.min(combined[1], extent[1]),
            Math.max(combined[2], extent[2]),
            Math.max(combined[3], extent[3])
          ]
        : [...extent];
    });
    return combined;
  }

  private isValidMapExtent(extent: number[] | null): extent is number[] {
    if (!extent) return false;
    const webMercatorLimit = 20037508.35 * 1.01;
    return extent.length === 4
      && extent.every(value => Number.isFinite(value) && Math.abs(value) <= webMercatorLimit)
      && extent[0] <= extent[2]
      && extent[1] <= extent[3];
  }

  // Drawing Tools (Manual Draw)
  startDrawing(): void {
    if (!this.map) return;

    if (this.currentDrawStep === 'COMPLETED') {
      this.showCustomAlert('Uyarı', 'Tüm geometriler çizildi. Yeni çizim için Çalışma Alanını Temizleyiniz.', 'alert');
      return;
    }

    this.removeDrawInteraction();
    this.removeModifyInteraction();
    this.isDrawingActive = true;
    this.drawPointsCount = 0;
    this.geometryStates[this.currentDrawStep] = 'Çiziliyor';

    this.drawInteraction = new Draw({
      source: this.vectorSource,
      type: 'Polygon',
      minPoints: 4,
      maxPoints: 4
    });

    this.map.addInteraction(this.drawInteraction);

    // Track points count in real-time
    this.drawInteraction.on('drawstart', (event) => {
      const geom = event.feature.getGeometry();
      if (geom) {
        geom.on('change', (evt: any) => {
          const coords = evt.target.getCoordinates();
          if (coords && coords[0]) {
            // Subtract mouse cursor and duplicate start/end connection node
            this.drawPointsCount = Math.max(0, coords[0].length - 2);
          }
        });
      }
    });

    this.drawInteraction.on('drawend', (event) => {
      const geom = event.feature.getGeometry();
      if (!geom) return;

      const coords = (geom as any).getCoordinates();
      if (coords && coords[0]) {
        const ring = coords[0];
        // Validate exactly 4 distinct vertices
        const uniqueCoords: any[] = [];
        ring.forEach((c: any) => {
          if (!uniqueCoords.some(uc => Math.abs(uc[0] - c[0]) < 1e-7 && Math.abs(uc[1] - c[1]) < 1e-7)) {
            uniqueCoords.push(c);
          }
        });

        if (uniqueCoords.length !== 4) {
          this.showCustomAlert('Hata', 'Poligon tam olarak 4 farklı köşe noktasından oluşmalıdır.', 'error');
          setTimeout(() => {
            this.vectorSource.removeFeature(event.feature);
          }, 0);
          return;
        }
      }

      const geoJsonStr = this.writeApiGeometry(geom);

      const step = this.currentDrawStep;
      event.feature.set('type', step);

      if (step === 'A') {
        this.drawnGeometries.A = geoJsonStr;
        this.geometryStates.A = 'Tamamlandı';
        this.currentDrawStep = 'B';
        this.onGeometryChange();
        this.pushToHistory();
        // Automatically start drawing B
        setTimeout(() => this.startDrawing(), 50);
      } else if (step === 'B') {
        this.drawnGeometries.B = geoJsonStr;
        this.geometryStates.B = 'Tamamlandı';
        this.currentDrawStep = 'C';
        this.onGeometryChange();
        this.pushToHistory();
        // Automatically start drawing C
        setTimeout(() => this.startDrawing(), 50);
      } else if (step === 'C') {
        this.drawnGeometries.C = geoJsonStr;
        this.geometryStates.C = 'Tamamlandı';
        this.currentDrawStep = 'COMPLETED';
        this.isDrawingActive = false;
        this.removeDrawInteraction();
        this.onGeometryChange();
        this.pushToHistory();
      }
    });
  }

  removeDrawInteraction(): void {
    if (this.map && this.drawInteraction) {
      this.map.removeInteraction(this.drawInteraction);
      this.drawInteraction = null;
    }
    this.isDrawingActive = false;
  }

  // Cancel Drawing or Modifying
  cancelActiveOperation(): void {
    if (this.redrawBackup) {
      const backup = this.redrawBackup;
      this.vectorSource.getFeatures()
        .filter(feature => feature.get('type') === backup.step)
        .forEach(feature => this.vectorSource.removeFeature(feature));
      this.drawnGeometries[backup.step] = backup.geometry;
      this.geometryStates[backup.step] = backup.status;
      const feature = new Feature({ geometry: this.readApiGeometry(backup.geometry) });
      feature.set('type', backup.step);
      this.vectorSource.addFeature(feature);
      this.redrawBackup = null;
    } else if (this.editBackup) {
      const backup = this.editBackup;
      this.drawnGeometries[backup.step] = backup.geometry;
      this.geometryStates[backup.step] = backup.status;
      const feature = this.vectorSource.getFeatures().find(item => item.get('type') === backup.step);
      feature?.setGeometry(this.readApiGeometry(backup.geometry));
      this.editBackup = null;
    } else if (this.isDrawingActive && this.currentDrawStep !== 'COMPLETED') {
      this.geometryStates[this.currentDrawStep] = this.drawnGeometries[this.currentDrawStep]
        ? (this.dbIds[this.currentDrawStep] ? 'Kaydedildi' : 'Tamamlandı')
        : 'Bekliyor';
    }

    this.removeDrawInteraction();
    this.removeModifyInteraction();
  }

  // Modify Geometry
  editGeometry(step: 'A' | 'B' | 'C'): void {
    if (!this.map) return;
    if (!this.drawnGeometries[step]) {
      this.showCustomAlert('Hata', `${step} geometrisi henüz çizilmedi.`, 'error');
      return;
    }

    this.removeDrawInteraction();
    this.removeModifyInteraction();

    this.isEditingActive = true;
    this.activeEditGeometry = step;

    // Find feature of type
    const feature = this.vectorSource.getFeatures().find(f => f.get('type') === step);
    if (!feature) {
      this.isEditingActive = false;
      this.activeEditGeometry = null;
      return;
    }

    this.editBackup = {
      step,
      geometry: this.drawnGeometries[step]!,
      status: this.geometryStates[step]
    };
    this.geometryStates[step] = 'Düzenleniyor';

    const collection = new Collection([feature]);
    this.modifyInteraction = new Modify({
      features: collection
    });

    this.map.addInteraction(this.modifyInteraction);
  }

  saveModifiedGeometry(): void {
    if (!this.activeEditGeometry || !this.modifyInteraction) return;

    const step = this.activeEditGeometry;
    const feature = this.vectorSource.getFeatures().find(f => f.get('type') === step);
    if (feature) {
      const geom = feature.getGeometry();
      if (geom) {
        const coords = (geom as any).getCoordinates();
        if (coords && coords[0]) {
          const ring = coords[0];
          // Validate minimum 4 distinct vertices
          const uniqueCoords: any[] = [];
          ring.forEach((c: any) => {
            if (!uniqueCoords.some(uc => Math.abs(uc[0] - c[0]) < 1e-7 && Math.abs(uc[1] - c[1]) < 1e-7)) {
              uniqueCoords.push(c);
            }
          });

          if (uniqueCoords.length !== 4) {
            this.showCustomAlert('Hata', 'Düzenleme sonucunda poligon tam olarak 4 farklı köşe noktasından oluşmalıdır. Kaydedilemedi.', 'error');
            return;
          }
        }

        this.drawnGeometries[step] = this.writeApiGeometry(geom);
        this.geometryStates[step] = this.dbIds[step] ? 'Değiştirildi' : 'Tamamlandı';
        this.editBackup = null;

        this.onGeometryChange();

        this.isEditingActive = false;
        this.activeEditGeometry = null;
        this.removeModifyInteraction();

        // Push change to history
        this.pushToHistory();
        this.showCustomAlert('Başarılı', `${step} geometrisi düzenlemeleri başarıyla uygulandı. Analiz sonuçları güncellenmelidir.`, 'alert');
      }
    }
  }

  removeModifyInteraction(): void {
    if (this.map && this.modifyInteraction) {
      this.map.removeInteraction(this.modifyInteraction);
      this.modifyInteraction = null;
    }
    this.isEditingActive = false;
    this.activeEditGeometry = null;
  }

  // Delete single geometry (Soft Delete)
  deleteGeometry(step: 'A' | 'B' | 'C'): void {
    const dbId = this.dbIds[step];
    if (dbId) {
      // Kalıcı veritabanı silme onayı
      const confirmMsg = `${step} geometrisini veritabanından silmek istediğinizden emin misiniz?\nBu işlem geometri grubunu ve bu geometriye bağlı tüm analiz sonuçlarını etkileyecektir.`;
      this.showCustomAlert('Silme Onayı', confirmMsg, 'confirm').then((confirmed) => {
        if (confirmed) {
          this.spatialAnalysisService.deleteGeometry(dbId).subscribe({
            next: () => {
              this.executeLocalDelete(step);
              this.showCustomAlert('Başarılı', `${step} geometrisi veritabanından başarıyla silindi ve analiz sonuçları güncel değil işaretlendi.`, 'alert');
            },
            error: (err: any) => {
              this.showCustomAlert('Hata', this.getSpatialErrorMessage(err, 'Geometri silinirken bir hata oluştu.'), 'error');
            }
          });
        }
      });
    } else {
      // Kaydedilmemiş yerel silme
      this.executeLocalDelete(step);
    }
  }

  executeLocalDelete(step: 'A' | 'B' | 'C'): void {
    delete this.drawnGeometries[step];
    delete this.dbIds[step];
    this.geometryStates[step] = 'Bekliyor';

    // Remove feature from map
    const features = this.vectorSource.getFeatures().filter(f => f.get('type') === step);
    features.forEach(f => this.vectorSource.removeFeature(f));

    // Remove result layer
    this.resultSource.clear();

    // Recalculate the next missing geometry without touching the other states.
    this.updateCurrentDrawStep();
    this.onGeometryChange();

    this.pushToHistory();
  }

  // Redraw geometry (holds backup copy)
  redrawGeometry(step: 'A' | 'B' | 'C'): void {
    const backup = this.drawnGeometries[step];
    if (!backup) return;

    this.removeDrawInteraction();
    this.removeModifyInteraction();
    this.redrawBackup = { step, geometry: backup, status: this.geometryStates[step] };

    // Clear feature
    const features = this.vectorSource.getFeatures().filter(f => f.get('type') === step);
    features.forEach(f => this.vectorSource.removeFeature(f));

    // Remove result
    this.resultSource.clear();

    this.drawnGeometries[step] = undefined;
    this.currentDrawStep = step;
    this.isDrawingActive = true;
    this.geometryStates[step] = 'Çiziliyor';
    this.drawPointsCount = 0;

    this.drawInteraction = new Draw({
      source: this.vectorSource,
      type: 'Polygon',
      minPoints: 4,
      maxPoints: 4
    });
    this.map?.addInteraction(this.drawInteraction);

    // Track points
    this.drawInteraction.on('drawstart', (event) => {
      const geom = event.feature.getGeometry();
      geom?.on('change', (evt: any) => {
        const coords = evt.target.getCoordinates();
        if (coords && coords[0]) {
          this.drawPointsCount = Math.max(0, coords[0].length - 2);
        }
      });
    });

    this.drawInteraction.on('drawend', (event) => {
      const geom = event.feature.getGeometry();
      if (!geom) return;

      const coords = (geom as any).getCoordinates();
      if (coords && coords[0]) {
        const ring = coords[0];
        const uniqueCoords: any[] = [];
        ring.forEach((c: any) => {
          if (!uniqueCoords.some(uc => Math.abs(uc[0] - c[0]) < 1e-7 && Math.abs(uc[1] - c[1]) < 1e-7)) {
            uniqueCoords.push(c);
          }
        });

        if (uniqueCoords.length !== 4) {
          this.showCustomAlert('Hata', 'Poligon tam olarak 4 farklı köşe noktasından oluşmalıdır.', 'error');
          setTimeout(() => {
            this.vectorSource?.removeFeature(event.feature);
          }, 0);
          return;
        }
      }

      event.feature.set('type', step);
      this.showCustomAlert('Yeniden Çizme Onayı', 'Yeni çizim eskisinin yerine geçecektir. Onaylıyor musunuz?', 'confirm').then((confirmed) => {
        if (confirmed) {
          this.drawnGeometries[step] = this.writeApiGeometry(geom);
          this.geometryStates[step] = this.dbIds[step] ? 'Değiştirildi' : 'Tamamlandı';
          this.redrawBackup = null;

          this.updateCurrentDrawStep();
          this.isDrawingActive = false;
          this.removeDrawInteraction();

          this.onGeometryChange();

          // Persist only the local state; the backend is called by the explicit Save button.
          this.pushToHistory();
        } else {
          this.cancelActiveOperation();
          this.updateCurrentDrawStep();
        }
      });
    });
  }

  private updateCurrentDrawStep(): void {
    this.currentDrawStep = (['A', 'B', 'C'] as GeometryStep[]).find(step => !this.drawnGeometries[step]) ?? 'COMPLETED';
  }

  // Focus Map on Geometry
  focusGeometry(step: 'A' | 'B' | 'C'): void {
    if (!this.map) return;
    const feature = this.vectorSource.getFeatures().find(f => f.get('type') === step);
    if (feature) {
      const geom = feature.getGeometry();
      if (geom) {
        const extent = geom.getExtent();
        this.map.getView().fit(extent, { padding: [100, 100, 100, 100], duration: 400 });
      }
    }
  }

  // Handle Automatic Geometry selection
  onGroupSelectChange(): void {
    if (this.selectionMethod !== 'auto') return;
    if (!this.selectedGroup) {
      return;
    }

    const requestedGroup = this.selectedGroup;

    this.vectorSource.clear();
    this.resultSource.clear();
    this.hasResult = false;
    this.analysisResult = null;
    this.drawnGeometries = {};
    this.dbIds = {};
    this.geometryStates = this.createInitialGeometryStates();

    this.spatialAnalysisService.getGroupGeometries(requestedGroup).subscribe({
      next: (res) => {
        if (this.selectionMethod !== 'auto' || this.selectedGroup !== requestedGroup) return;
        const format = new GeoJSON();
        res.forEach((item) => {
          const geom = format.readGeometry(item.geometry, {
            dataProjection: 'EPSG:4326',
            featureProjection: 'EPSG:3857'
          });
          const feature = new Feature({
            geometry: geom
          });
          feature.set('type', item.operationType);
          this.vectorSource.addFeature(feature);

          if (item.operationType === 'A') {
            this.drawnGeometries.A = item.geometry;
            this.dbIds.A = item.id;
            this.geometryStates.A = 'Kaydedildi';
          }
          if (item.operationType === 'B') {
            this.drawnGeometries.B = item.geometry;
            this.dbIds.B = item.id;
            this.geometryStates.B = 'Kaydedildi';
          }
          if (item.operationType === 'C') {
            this.drawnGeometries.C = item.geometry;
            this.dbIds.C = item.id;
            this.geometryStates.C = 'Kaydedildi';
          }
        });

        this.currentDrawStep = 'COMPLETED';
        this.pushToHistory();
        this.resetMapView();
      },
      error: (err) => {
        this.showCustomAlert('Hata', this.getSpatialErrorMessage(err, 'Geometri grubu yüklenirken bir hata oluştu.'), 'error');
      }
    });
  }

  // Compute Spatial Operation Analysis
  computeAnalysis(): void {
    if (!this.drawnGeometries.A || !this.drawnGeometries.B || !this.drawnGeometries.C) {
      this.showCustomAlert('Hata', 'Analiz başlatabilmek için A, B ve C geometrilerinin hazır olması gerekir.', 'error');
      return;
    }

    if (this.selectionMethod === 'manual' && !this.groupLabel.trim()) {
      this.showCustomAlert('Hata', 'Lütfen analiz grubu için geçerli bir etiket adı giriniz.', 'error');
      return;
    }

    this.isComputing = true;
    this.isSaved = false;
    this.runOperationAnalysis();
  }

  private runOperationAnalysis(): void {
    const dto: GeometryRequestDto = {
      label: this.selectionMethod === 'manual' ? this.groupLabel : this.selectedGroup,
      operationType: this.selectedOperation
    };

    if (this.selectionMethod === 'manual') {
      dto.geometries = [this.drawnGeometries.A!, this.drawnGeometries.B!, this.drawnGeometries.C!];
    } else {
      dto.selectedLabel = this.selectedGroup;
    }

    this.spatialAnalysisService.analyze(dto).subscribe({
      next: (res) => {
        this.isComputing = false;

        // If backend returned hasResult = false, show warning and clear result features
        if (!res.hasResult) {
          this.hasResult = false;
          this.analysisResult = null;
          
          this.resultSource.clear();
          this.showCustomAlert('Analiz Sonucu', res.message, 'alert');
          return;
        }

        this.hasResult = true;
        this.analysisResult = res;
        this.isSaved = res.isPersisted;

        // Load result feature into map
        if (res.resultGeometryGeoJson) {
          this.resultSource.clear();

          const format = new GeoJSON();
          const geom = format.readGeometry(res.resultGeometryGeoJson, {
            dataProjection: 'EPSG:4326',
            featureProjection: 'EPSG:3857'
          });
          const resultFeature = new Feature({
            geometry: geom
          });
          resultFeature.set('type', 'RESULT');
          this.resultSource.addFeature(resultFeature);
        }

        let operationLabel = res.operationLabel || 'Sonuç Alanı';

        // Setup results breakdown
        this.constituentGeometries = [
          { name: 'A Poligonu', desc: 'Analize katılan A geometrisi', area: this.getGeomAreaText(this.drawnGeometries.A), color: '#3b82f6' },
          { name: 'B Poligonu', desc: 'Analize katılan B geometrisi', area: this.getGeomAreaText(this.drawnGeometries.B), color: '#f59e0b' },
          { name: 'C Poligonu', desc: 'Analize katılan C geometrisi', area: this.getGeomAreaText(this.drawnGeometries.C), color: '#8b5cf6' },
          { name: operationLabel, desc: 'Analiz sonucu oluşan alan', area: this.formatNumber(res.resultAreaM2, 2) + ' m²', color: '#10b981' }
        ];

        this.geometriesChangedAfterAnalysis = false;
        // Keep current camera view (do not auto-zoom out/reset zoom level after calculation)
        // this.fitAnalysisResult();
        this.loadGroups();
      },
      error: (err) => {
        this.isComputing = false;
        this.showCustomAlert('Hata', this.getSpatialErrorMessage(err, 'Analiz hesaplanırken bir hata oluştu.'), 'error');
      }
    });
  }

  getGeomAreaText(geoJsonStr?: string): string {
    if (!geoJsonStr) return '0 m²';
    try {
      const geom = this.readApiGeometry(geoJsonStr);
      const area = getArea(geom, { projection: 'EPSG:3857' });
      return this.formatNumber(area, 2) + ' m²';
    } catch {
      return 'Bilinmiyor';
    }
  }

  formatNumber(val: number | null | undefined, fractionDigits: number = 2): string {
    if (val === null || val === undefined || isNaN(val)) {
      return 'Alan hesaplanamadı';
    }
    const parts = val.toFixed(fractionDigits).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return parts.join(',');
  }

  // Clear workspace (preserves DB data)
  clearWorkspace(): void {
    this.showCustomAlert('Temizleme Onayı', 'Tüm çalışma alanını ve yerel çizimlerinizi temizlemek istediğinizden emin misiniz?', 'confirm').then((confirmed) => {
      if (confirmed) {
        this.resetWorkspace();
        this.pushToHistory();
      }
    });
  }

  private resetWorkspace(): void {
    this.removeDrawInteraction();
    this.removeModifyInteraction();
    this.vectorSource.clear();
    this.resultSource.clear();
    this.drawnGeometries = {};
    this.dbIds = {};
    this.geometryStates = this.createInitialGeometryStates();
    this.currentDrawStep = 'A';
    this.isDrawingActive = false;
    this.isEditingActive = false;
    this.activeEditGeometry = null;
    this.hasResult = false;
    this.isSaved = false;
    this.analysisResult = null;
    this.constituentGeometries = [];
    this.selectedGroup = '';
    this.geometriesChangedAfterAnalysis = false;
    this.isSaving = {};
    this.isSavingGroup = false;
    this.editBackup = null;
    this.redrawBackup = null;

    // Clear state retention on full reset
    localStorage.removeItem('lastActiveGroup');
    localStorage.removeItem('selectionMethod');
  }

  // Feature Stylings mapping
  private getFeatureStyle(feature: Feature<Geometry>): Style {
    const type = feature.get('type');
    let fillColor = 'rgba(59, 130, 246, 0.2)'; // default
    let strokeColor = '#3b82f6';
    let lineDash: number[] | undefined = undefined;

    if (type === 'A') {
      fillColor = 'rgba(59, 130, 246, 0.25)'; // Blue
      strokeColor = '#3b82f6';
    } else if (type === 'B') {
      fillColor = 'rgba(245, 158, 11, 0.25)'; // Orange
      strokeColor = '#f59e0b';
    } else if (type === 'C') {
      fillColor = 'rgba(139, 92, 246, 0.25)'; // Purple
      strokeColor = '#8b5cf6';
    } else if (type === 'RESULT') {
      fillColor = 'rgba(16, 185, 129, 0.35)'; // Result green, translucent so A/B/C remain visible
      strokeColor = '#10b981';
      lineDash = [4, 4];
    }

    let textStr = '';
    if (type === 'A' || type === 'B' || type === 'C') {
      textStr = type;
    } else if (type === 'RESULT') {
      if (this.analysisResult) {
        let label = 'Sonuç';
        if (this.analysisResult.operationLabel.indexOf('Kesişim') > -1) {
          label = 'Kesişim Alanı';
        } else if (this.analysisResult.operationLabel.indexOf('D Birleşim') > -1) {
          label = 'D Birleşim Alanı';
        } else if (this.analysisResult.operationLabel.indexOf('E Genel') > -1) {
          label = 'E Birleşim Alanı';
        }
        textStr = `${label}: ${this.formatNumber(this.analysisResult.resultAreaM2, 2)} m²`;
      }
    }

    const mainStyle = new Style({
      fill: new Fill({
        color: fillColor
      }),
      stroke: new Stroke({
        color: strokeColor,
        width: 3,
        lineDash: lineDash
      })
    });

    if (!textStr) {
      return mainStyle;
    }

    // Determine text geometry to avoid duplicate rendering on multi-part geometries (like MultiPolygons)
    let textGeometry: any = undefined;
    if (type === 'RESULT') {
      const geom = feature.getGeometry();
      if (geom) {
        if (geom.getType() === 'MultiPolygon') {
          const polys = (geom as any).getPolygons();
          if (polys.length > 0) {
            textGeometry = polys[0].getInteriorPoint();
          }
        } else if (geom.getType() === 'Polygon') {
          textGeometry = (geom as any).getInteriorPoint();
        }
      }
    }

    const textStyle = new Style({
      text: new Text({
        text: textStr,
        font: type === 'RESULT' ? 'bold 12px sans-serif' : 'bold 16px sans-serif',
        fill: new Fill({
          color: '#ffffff'
        }),
        stroke: new Stroke({
          color: strokeColor,
          width: 3
        }),
        overflow: true
      })
    });

    if (textGeometry) {
      textStyle.setGeometry(textGeometry);
      return [mainStyle, textStyle] as any;
    }

    // For manual shapes A, B, C, just set text on the main style
    mainStyle.setText(textStyle.getText()!);
    return mainStyle;
  }

  @HostListener('window:beforeunload', ['$event'])
  unloadNotification($event: any): void {
    if (this.hasUnsavedChanges()) {
      $event.returnValue = true;
    }
  }

  hasUnsavedChanges(): boolean {
    if (this.selectionMethod === 'manual') {
      return (!!this.drawnGeometries.A && (this.geometryStates.A === 'Tamamlandı' || this.geometryStates.A === 'Değiştirildi'))
          || (!!this.drawnGeometries.B && (this.geometryStates.B === 'Tamamlandı' || this.geometryStates.B === 'Değiştirildi'))
          || (!!this.drawnGeometries.C && (this.geometryStates.C === 'Tamamlandı' || this.geometryStates.C === 'Değiştirildi'));
    }
    return false;
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  toggleLayerPanel(): void {
    this.showLayerPanel = !this.showLayerPanel;
  }

  changeBaseLayer(type: 'osm' | 'google'): void {
    this.mapManager.baseLayerType = type;
    this.mapManager.saveSettings();
    this.applyCurrentMapSettings();
  }

  changeVectorOpacity(event: any): void {
    const val = Number(event.target.value) / 100;
    this.mapManager.vectorOpacity = val;
    this.mapManager.saveSettings();
    this.applyCurrentMapSettings();
  }

  toggleBaseLayerVisible(): void {
    this.mapManager.baseLayerVisible = !this.mapManager.baseLayerVisible;
    this.mapManager.saveSettings();
    this.applyCurrentMapSettings();
  }

  toggleVectorLayerVisible(): void {
    this.mapManager.vectorLayerVisible = !this.mapManager.vectorLayerVisible;
    this.mapManager.saveSettings();
    this.applyCurrentMapSettings();
  }

  applyCurrentMapSettings(): void {
    if (this.map && this.baseLayer) {
      this.mapManager.applyMapSettings(this.map, this.baseLayer, this.vectorLayer);
    }
  }
}
