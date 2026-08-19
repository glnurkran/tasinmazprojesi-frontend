import { Component, OnInit, AfterViewInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// OpenLayers Imports
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import { fromLonLat, toLonLat } from 'ol/proj';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import Polygon from 'ol/geom/Polygon';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Style, Icon, Stroke, Fill } from 'ol/style';

import { Router } from '@angular/router';

// Services & Models
import { TasinmazService } from '../services/tasinmaz.service';
import { IlIlceMahalleService } from '../services/il-ilce-mahalle.service';
import { AuthService } from '../services/auth.service';
import { MapManagerService } from '../services/map-manager.service';
import { TasinmazDto } from '../models/tasinmaz.model';
import { IlDto, IlceDto, MahalleDto } from '../models/il-ilce-mahalle.model';
import { TasinmazResim } from '../models/tasinmaz-resim.model';

export interface Property {
  id: number;
  isim: string;
  province: string;
  district: string;
  neighborhood: string;
  ada: string;
  parsel: string;
  nitelik: string;
  lat: number;
  lng: number;
  address: string;
  mahalleId: number;
  userEmail?: string;
}

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit, AfterViewInit, OnDestroy {
  // Properties List
  properties: Property[] = [];
  selectedPropertyIds: number[] = [];



  // Optional Photo Upload (during Tasinmaz Add)
  optionalPhotoFile: File | null = null;
  optionalPhotoPreview: string | null = null;

  isBulkDeleteConfirmOpen: boolean = false;

  // Coğrafi Veri Listeleri
  illerList: IlDto[] = [];
  ilcelerList: IlceDto[] = [];
  mahallelerList: MahalleDto[] = [];

  // Veritabanından gelen orijinal listeler (Mock verilerle harmanlanmamış olanlar)
  dbIller: IlDto[] = [];
  dbIlceler: IlceDto[] = [];
  dbMahalleler: MahalleDto[] = [];

  // Filtrelenmiş Seçim Listeleri (Cascading Dropdown)
  filteredIlceler: IlceDto[] = [];
  filteredMahalleler: MahalleDto[] = [];

  // OpenLayers Main Map State
  mainMap!: Map;
  mainView!: View;
  mainBaseLayer!: TileLayer<any>;
  mainVectorSource!: VectorSource;
  mainVectorLayer!: VectorLayer<VectorSource>;

  // OpenLayers Mini Map State (Modal)
  miniMap: Map | null = null;
  miniView: View | null = null;
  miniBaseLayer: TileLayer<any> | null = null;
  miniVectorSource: VectorSource | null = null;
  miniVectorLayer: VectorLayer<VectorSource> | null = null;

  // Map & Popup State
  selectedProperty: Property | null = null;
  popupOverlayCoordinate: number[] | null = null;
  showLayerPanel = false;

  // Search
  searchQuery: string = '';

  // Add/Edit Modal Control
  isModalOpen: boolean = false;
  isEditMode: boolean = false;
  editingId: number | null = null;
  propertyForm!: FormGroup;

  // Custom Delete Confirm State
  isDeleteConfirmOpen: boolean = false;
  propertyToDelete: Property | null = null;

  // Custom Info Alert State
  isInfoAlertOpen: boolean = false;
  infoAlertTitle: string = '';
  infoAlertMessage: string = '';
  
  lastGeocodedAddress: string = '';

  isExportingExcel: boolean = false;
  isExportingPdf: boolean = false;
  isImportingExcel: boolean = false;

  constructor(
    private fb: FormBuilder,
    private tasinmazService: TasinmazService,
    private geoService: IlIlceMahalleService,
    public authService: AuthService,
    private router: Router,
    private http: HttpClient,
    public mapManager: MapManagerService
  ) {}

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  ngOnInit(): void {
    // Form yapılandırması (İlçe ve Mahalle varsayılan olarak kilitli başlatılır)
    this.propertyForm = this.fb.group({
      isim: ['', [Validators.required, Validators.minLength(3)]], // Taşınmaz adı eklendi
      province: ['', Validators.required],
      district: [{ value: '', disabled: true }, Validators.required],
      neighborhood: [{ value: '', disabled: true }, Validators.required],
      nitelik: ['Daire', Validators.required],
      ada: ['', [Validators.required, Validators.pattern(/^\d+$/)]],
      parsel: ['', [Validators.required, Validators.pattern(/^\d+$/)]],
      lat: [39.9208, [Validators.required, Validators.pattern(/^-?\d+(\.\d+)?$/)]],
      lng: [32.8541, [Validators.required, Validators.pattern(/^-?\d+(\.\d+)?$/)]],
      address: ['', Validators.required]
    });

    // Form koordinat değişimlerini haritaya anlık yansıt
    this.propertyForm.get('lat')?.valueChanges.subscribe(val => {
      if (val === null || val === '') return;
      const lat = Number(val);
      const lngVal = this.propertyForm.get('lng')?.value;
      if (lngVal === null || lngVal === '') return;
      const lng = Number(lngVal);
      if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90) {
        this.updateMiniMapMarker(lat, lng);
      }
    });

    this.propertyForm.get('lng')?.valueChanges.subscribe(val => {
      if (val === null || val === '') return;
      const lng = Number(val);
      const latVal = this.propertyForm.get('lat')?.value;
      if (latVal === null || latVal === '') return;
      const lat = Number(latVal);
      if (!isNaN(lat) && !isNaN(lng) && lng >= -180 && lng <= 180) {
        this.updateMiniMapMarker(lat, lng);
      }
    });

    // İl seçim değerinin değişimi (Cascading Dropdown)
    this.propertyForm.get('province')?.valueChanges.subscribe(provName => {
      const districtCtrl = this.propertyForm.get('district');
      const neighCtrl = this.propertyForm.get('neighborhood');

      // Alt seçimleri sıfırla ve kilitle
      districtCtrl?.setValue('');
      districtCtrl?.disable();
      neighCtrl?.setValue('');
      neighCtrl?.disable();

      this.filteredIlceler = [];
      this.filteredMahalleler = [];

      if (provName) {
        const il = this.illerList.find(i => i.ilAdi.toLowerCase() === provName.toLowerCase());
        if (il) {
          this.filteredIlceler = this.ilcelerList.filter(i => i.ilId === il.id);
          districtCtrl?.enable();
        }
      }
    });

    // İlçe seçim değerinin değişimi (Cascading Dropdown)
    this.propertyForm.get('district')?.valueChanges.subscribe(distName => {
      const neighCtrl = this.propertyForm.get('neighborhood');

      // Mahalle seçimini sıfırla ve kilitle
      neighCtrl?.setValue('');
      neighCtrl?.disable();

      this.filteredMahalleler = [];

      if (distName) {
        const provName = this.propertyForm.get('province')?.value;
        const il = this.illerList.find(i => i.ilAdi.toLowerCase() === provName.toLowerCase());
        const ilce = il ? this.ilcelerList.find(i => i.ilId === il.id && i.ilceAdi.toLowerCase() === distName.toLowerCase()) : null;
        if (ilce) {
          this.filteredMahalleler = this.mahallelerList.filter(m => m.ilceId === ilce.id);
          neighCtrl?.enable();
        }
      }
    });

    // Mahalle seçiminin değişimi (Otomatik Coğrafi Konum Bulma)
    this.propertyForm.get('neighborhood')?.valueChanges.subscribe(neighName => {
      if (neighName) {
        const provName = this.propertyForm.get('province')?.value;
        const distName = this.propertyForm.get('district')?.value;
        if (provName && distName) {
          this.triggerAutoGeocoding(provName, distName, neighName);
        }
      }
    });

    // İlk olarak coğrafi verileri ve taşınmazları yükle
    this.loadGeographicalAndPropertiesData();
  }

  ngAfterViewInit(): void {
    this.initMainMap();
  }

  ngOnDestroy(): void {
    if (this.mainMap) {
      this.mainMap.setTarget(undefined);
    }
    if (this.miniMap) {
      this.miniMap.setTarget(undefined);
    }
  }

  // Coğrafi verileri ve taşınmazları yükler
  loadGeographicalAndPropertiesData(): void {
    forkJoin({
      iller: this.geoService.getIller(),
      ilceler: this.geoService.getIlceler(),
      mahalleler: this.geoService.getMahalleler()
    }).subscribe({
      next: (res) => {
        const dbIller = res.iller || [];
        const dbIlceler = res.ilceler || [];
        const dbMahalleler = res.mahalleler || [];

        // Orijinal veritabanı kayıtlarını sakla (kaydederken kontrol etmek için)
        this.dbIller = [...dbIller];
        this.dbIlceler = [...dbIlceler];
        this.dbMahalleler = [...dbMahalleler];

        // Örnek verilerimizin listesi (Ankara, İstanbul, İzmir)
        const sampleIller = [
          { id: 1, ilAdi: 'Ankara' },
          { id: 2, ilAdi: 'İstanbul' },
          { id: 3, ilAdi: 'İzmir' }
        ];

        const sampleIlceler = [
          { id: 10, ilceAdi: 'Çankaya', ilId: 1 },
          { id: 11, ilceAdi: 'Keçiören', ilId: 1 },
          { id: 20, ilceAdi: 'Kadıköy', ilId: 2 },
          { id: 21, ilceAdi: 'Beşiktaş', ilId: 2 },
          { id: 30, ilceAdi: 'Bornova', ilId: 3 },
          { id: 31, ilceAdi: 'Karşıyaka', ilId: 3 }
        ];

        const sampleMahalleler = [
          { id: 100, mahalleAdi: 'Bahçelievler', ilceId: 10 },
          { id: 101, mahalleAdi: 'Kavaklıdere', ilceId: 10 },
          { id: 110, mahalleAdi: 'Etlik', ilceId: 11 },
          { id: 111, mahalleAdi: 'Ayvalı', ilceId: 11 },
          { id: 200, mahalleAdi: 'Moda', ilceId: 20 },
          { id: 201, mahalleAdi: 'Bostancı', ilceId: 20 },
          { id: 210, mahalleAdi: 'Bebek', ilceId: 21 },
          { id: 211, mahalleAdi: 'Ortaköy', ilceId: 21 },
          { id: 300, mahalleAdi: 'Kazımdirik', ilceId: 30 },
          { id: 301, mahalleAdi: 'Erzene', ilceId: 30 },
          { id: 310, mahalleAdi: 'Mavişehir', ilceId: 31 },
          { id: 311, mahalleAdi: 'Bostanlı', ilceId: 31 }
        ];

        // 1. İller Birleştirilir (Mükerrerlik engellenir)
        const mergedIller = [...dbIller];
        sampleIller.forEach(si => {
          if (!mergedIller.some(i => i.ilAdi.toLowerCase() === si.ilAdi.toLowerCase())) {
            mergedIller.push(si);
          }
        });
        this.illerList = mergedIller;

        // 2. İlçeler Birleştirilir (İl ID eşleştirmeleri korunur)
        const mergedIlceler = [...dbIlceler];
        sampleIlceler.forEach(sic => {
          const matchingSampleIl = sampleIller.find(i => i.id === sic.ilId);
          if (matchingSampleIl) {
            const activeIl = this.illerList.find(i => i.ilAdi.toLowerCase() === matchingSampleIl.ilAdi.toLowerCase());
            if (activeIl) {
              if (!mergedIlceler.some(ic => ic.ilceAdi.toLowerCase() === sic.ilceAdi.toLowerCase() && ic.ilId === activeIl.id)) {
                mergedIlceler.push({
                  id: sic.id,
                  ilceAdi: sic.ilceAdi,
                  ilId: activeIl.id!
                });
              }
            }
          }
        });
        this.ilcelerList = mergedIlceler;

        // 3. Mahalleler Birleştirilir (İlçe ID eşleştirmeleri korunur)
        const mergedMahalleler = [...dbMahalleler];
        sampleMahalleler.forEach(sm => {
          const matchingSampleIlce = sampleIlceler.find(ic => ic.id === sm.ilceId);
          if (matchingSampleIlce) {
            const activeIlce = this.ilcelerList.find(ic => ic.ilceAdi.toLowerCase() === matchingSampleIlce.ilceAdi.toLowerCase());
            if (activeIlce) {
              if (!mergedMahalleler.some(m => m.mahalleAdi.toLowerCase() === sm.mahalleAdi.toLowerCase() && m.ilceId === activeIlce.id)) {
                mergedMahalleler.push({
                  id: sm.id,
                  mahalleAdi: sm.mahalleAdi,
                  ilceId: activeIlce.id!
                });
              }
            }
          }
        });
        this.mahallelerList = mergedMahalleler;

        this.loadProperties();
      },
      error: (err) => {
        console.error('Coğrafi veriler yüklenirken hata oluştu:', err);
      }
    });
  }

  // Taşınmazları API'den çeker ve frontend modelleriyle eşleştirir
  loadProperties(): void {
    this.selectedPropertyIds = [];
    this.tasinmazService.getAll().subscribe({
      next: (res) => {
        this.properties = res.map(p => {
          // MahalleId üzerinden hiyerarşik İl, İlçe ve Mahalle adlarını eşleştir
          const mah = this.mahallelerList.find(m => m.id === p.mahalleId);
          const mahName = mah ? mah.mahalleAdi : '';
          const ilceId = mah ? mah.ilceId : 0;

          const ilce = this.ilcelerList.find(i => i.id === ilceId);
          const ilceName = ilce ? ilce.ilceAdi : '';
          const ilId = ilce ? ilce.ilId : 0;

          const il = this.illerList.find(i => i.id === ilId);
          const ilName = il ? il.ilAdi : '';

          // Koordinat formatını çöz (örn: "39.9208, 32.8541")
          let lat = 39.9208;
          let lng = 32.8541;
          if (p.koordinatBilgisi) {
            const coords = p.koordinatBilgisi.split(',');
            if (coords.length === 2) {
              lat = Number(coords[0].trim());
              lng = Number(coords[1].trim());
            }
          }

          return {
            id: p.id!,
            isim: p.isim,
            province: ilName || 'Bilinmiyor',
            district: ilceName || 'Bilinmiyor',
            neighborhood: mahName || 'Bilinmiyor',
            ada: p.ada,
            parsel: p.parsel.toString(),
            nitelik: p.nitelik,
            lat: lat,
            lng: lng,
            address: p.adres,
            mahalleId: p.mahalleId,
            userEmail: (p as any).userEmail || (p as any).UserEmail || (p as any).email || '-'
          };
        });

        this.updateMainMapFeatures();

        // Varsayılan ilk taşınmaza odaklan (zoom yapmadan)
        if (this.properties.length > 0) {
          setTimeout(() => {
            this.selectProperty(this.properties[0], false);
          }, 300);
        }
      },
      error: (err) => {
        console.error('Taşınmaz listesi çekilemedi:', err);
      }
    });
  }

  // Veritabanında İl/İlçe/Mahalle kontrol edip yoksa oluşturan akıllı metot (Self-Healing CBS Seeding)
  async getOrCreateMahalleId(provinceName: string, districtName: string, neighborhoodName: string): Promise<number> {
    // 1. İl kontrolü (Gerçek veritabanı listesinde ara)
    let il = this.dbIller.find(i => i.ilAdi.toLowerCase() === provinceName.toLowerCase());
    if (!il) {
      il = await this.geoService.addIl({ ilAdi: provinceName }).toPromise();
      if (il) {
        this.dbIller.push(il);
        this.illerList.push(il);
      }
    }

    // 2. İlçe kontrolü (Gerçek veritabanı listesinde ara)
    let ilce = this.dbIlceler.find(c => c.ilId === il!.id && c.ilceAdi.toLowerCase() === districtName.toLowerCase());
    if (!ilce) {
      ilce = await this.geoService.addIlce({ ilceAdi: districtName, ilId: il!.id! }).toPromise();
      if (ilce) {
        this.dbIlceler.push(ilce);
        this.ilcelerList.push(ilce);
      }
    }

    // 3. Mahalle kontrolü (Gerçek veritabanı listesinde ara)
    let mahalle = this.dbMahalleler.find(m => m.ilceId === ilce!.id && m.mahalleAdi.toLowerCase() === neighborhoodName.toLowerCase());
    if (!mahalle) {
      mahalle = await this.geoService.addMahalle({ mahalleAdi: neighborhoodName, ilceId: ilce!.id! }).toPromise();
      if (mahalle) {
        this.dbMahalleler.push(mahalle);
        this.mahallelerList.push(mahalle);
      }
    }

    return mahalle!.id!;
  }

  // OpenLayers Main Map Initialization with DOM element safety check and retry loop
  initMainMap(): void {
    const el = document.getElementById('main-map');
    if (!el) {
      setTimeout(() => this.initMainMap(), 50);
      return;
    }

    this.mainVectorSource = new VectorSource();
    this.mainVectorLayer = new VectorLayer({
      source: this.mainVectorSource
    });

    this.mainView = new View({
      center: fromLonLat([35.2433, 38.9637]), // Türkiye Coğrafi Merkezi
      zoom: 6.2,
      minZoom: 4,
      maxZoom: 19
    });

    this.mainBaseLayer = new TileLayer({
      source: this.mapManager.createBaseSource(this.mapManager.baseLayerType)
    });

    this.mainMap = new Map({
      target: 'main-map',
      layers: [
        this.mainBaseLayer,
        this.mainVectorLayer
      ],
      view: this.mainView,
      controls: []
    });

    // Apply settings from MapManager (Base map type, visibility, opacity, ScaleLine)
    this.mapManager.applyMapSettings(this.mainMap, this.mainBaseLayer, this.mainVectorLayer);

    this.mainMap.on('click', (evt) => {
      let found = false;
      this.mainMap.forEachFeatureAtPixel(evt.pixel, (feature: any) => {
        const prop = feature.get('property') as Property;
        if (prop) {
          this.selectProperty(prop);
          found = true;
        }
      });

      if (!found) {
        this.closeMapPopup();
      }
    });

    this.updateMainMapFeatures();
  }

  // Create property boundaries Polygon
  createPropertyPolygon(lng: number, lat: number): Polygon {
    const dLat = 0.0004; // ~40m
    const dLng = 0.0006; // ~50m
    const p1 = fromLonLat([lng - dLng, lat - dLat]);
    const p2 = fromLonLat([lng + dLng, lat - dLat]);
    const p3 = fromLonLat([lng + dLng, lat + dLat]);
    const p4 = fromLonLat([lng - dLng, lat + dLat]);
    return new Polygon([[p1, p2, p3, p4, p1]]);
  }

  // Main Map Pin Refresh
  updateMainMapFeatures(): void {
    if (!this.mainVectorSource) return;
    this.mainVectorSource.clear();

    this.properties.forEach(p => {
      // 1. Point Marker feature
      const markerFeature = new Feature({
        geometry: new Point(fromLonLat([p.lng, p.lat])),
        property: p
      });

      const isSelected = this.selectedProperty && this.selectedProperty.id === p.id;
      const fillHex = isSelected ? '%23ef4444' : '%231e88e5'; // Kırmızı : Mavi
      const scale = isSelected ? 1.2 : 0.9;
      
      const pinSvg = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36" fill="${fillHex}"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;

      markerFeature.setStyle(new Style({
        image: new Icon({
          src: pinSvg,
          scale: scale,
          anchor: [0.5, 1]
        })
      }));

      // 2. Polygon Boundary feature
      const polygonGeom = this.createPropertyPolygon(p.lng, p.lat);
      const polygonFeature = new Feature({
        geometry: polygonGeom,
        property: p
      });

      const strokeColor = isSelected ? '#ef4444' : '#1e88e5';
      const strokeWidth = isSelected ? 3 : 2;
      const fillColor = isSelected ? 'rgba(239, 68, 68, 0.2)' : 'rgba(30, 136, 229, 0.2)';

      polygonFeature.setStyle(new Style({
        stroke: new Stroke({
          color: strokeColor,
          width: strokeWidth
        }),
        fill: new Fill({
          color: fillColor
        })
      }));

      this.mainVectorSource.addFeature(polygonFeature);
      this.mainVectorSource.addFeature(markerFeature);
    });
  }

  // Mini Map (Modal) Initialization with DOM element safety check and retry loop
  initMiniMap(lat: number, lng: number): void {
    if (this.miniMap) {
      this.miniMap.setTarget(undefined);
      this.miniMap = null;
    }

    const tryInit = (retries = 0) => {
      const el = document.getElementById('mini-map');
      if (!el) {
        if (retries < 15) {
          setTimeout(() => tryInit(retries + 1), 80);
        }
        return;
      }

      this.miniVectorSource = new VectorSource();
      const markerFeature = new Feature({
        geometry: new Point(fromLonLat([lng, lat]))
      });

      const pinSvg = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36" fill="%23ef4444"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;
      
      markerFeature.setStyle(new Style({
        image: new Icon({
          src: pinSvg,
          scale: 0.9,
          anchor: [0.5, 1]
        })
      }));

      this.miniVectorSource.addFeature(markerFeature);

      this.miniVectorLayer = new VectorLayer({
        source: this.miniVectorSource
      });

      this.miniView = new View({
        center: fromLonLat([lng, lat]),
        zoom: 12,
        minZoom: 2,
        maxZoom: 19
      });

      this.miniBaseLayer = new TileLayer({
        source: this.mapManager.createBaseSource(this.mapManager.baseLayerType)
      });

      this.miniMap = new Map({
        target: 'mini-map',
        layers: [
          this.miniBaseLayer,
          this.miniVectorLayer
        ],
        view: this.miniView,
        controls: []
      });

      // Apply MapManager settings (visibility, base layer type, opacity, scale line)
      this.mapManager.applyMapSettings(this.miniMap, this.miniBaseLayer, this.miniVectorLayer);

      this.miniMap.on('click', (evt) => {
        const coords = toLonLat(evt.coordinate);
        const clickedLng = Number(coords[0].toFixed(5));
        const clickedLat = Number(coords[1].toFixed(5));

        this.propertyForm.patchValue({
          lat: clickedLat,
          lng: clickedLng
        });

        markerFeature.setGeometry(new Point(evt.coordinate));
      });
    };

    setTimeout(() => tryInit(), 80);
  }

  // Mini Map Marker Position Sync
  updateMiniMapMarker(lat: number, lng: number): void {
    if (this.miniVectorSource && this.miniView) {
      const features = this.miniVectorSource.getFeatures();
      if (features.length > 0) {
        features.forEach((feat: any) => {
          const geom = feat.getGeometry();
          if (geom instanceof Point) {
            feat.setGeometry(new Point(fromLonLat([lng, lat])));
          }
        });
      }
      this.miniView.setCenter(fromLonLat([lng, lat]));
    }
  }

  // Layer control panel helper methods
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
    if (this.mainMap && this.mainBaseLayer) {
      this.mapManager.applyMapSettings(this.mainMap, this.mainBaseLayer, this.mainVectorLayer);
      this.updateMainMapFeatures();
    }
    if (this.miniMap && this.miniBaseLayer) {
      this.mapManager.applyMapSettings(this.miniMap, this.miniBaseLayer, this.miniVectorLayer);
    }
  }

  // Filter properties based on search query
  get filteredProperties(): Property[] {
    if (!this.searchQuery.trim()) {
      return this.properties;
    }
    const query = this.searchQuery.toLowerCase();
    return this.properties.filter(p => 
      p.isim.toLowerCase().includes(query) ||
      p.province.toLowerCase().includes(query) ||
      p.district.toLowerCase().includes(query) ||
      p.neighborhood.toLowerCase().includes(query) ||
      p.ada.includes(query) ||
      p.parsel.includes(query) ||
      p.nitelik.toLowerCase().includes(query) ||
      p.address.toLowerCase().includes(query) ||
      (p.userEmail && p.userEmail.toLowerCase().includes(query))
    );
  }

  // Select Pin & Focus Map
  selectProperty(property: Property, shouldAnimate: boolean = true): void {
    this.selectedProperty = property;
    this.updateMainMapFeatures();
    
    if (shouldAnimate && this.mainView) {
      const polygonGeom = this.createPropertyPolygon(property.lng, property.lat);
      this.mainView.fit(polygonGeom.getExtent(), {
        padding: [80, 80, 80, 80],
        duration: 1000
      });
    }
  }

  // Map Zoom Control Tools
  zoomIn(): void {
    if (this.mainView) {
      const curr = this.mainView.getZoom();
      if (curr !== undefined) {
        this.mainView.animate({ zoom: curr + 1, duration: 250 });
      }
    }
  }

  zoomOut(): void {
    if (this.mainView) {
      const curr = this.mainView.getZoom();
      if (curr !== undefined) {
        this.mainView.animate({ zoom: curr - 1, duration: 250 });
      }
    }
  }

  resetMapView(): void {
    if (this.mainView) {
      this.mainView.animate({
        center: fromLonLat([35.2433, 38.9637]),
        zoom: 6.2,
        duration: 800
      });
    }
  }

  closeMapPopup(): void {
    this.selectedProperty = null;
    this.updateMainMapFeatures();
  }

  // Delete Action Trigger
  openDeleteConfirm(property: Property): void {
    if (this.authService.isAdmin()) {
      this.openInfoAlert('Yetkisiz İşlem', 'Yöneticiler (Admin) taşınmaz silemez.');
      return;
    }
    this.propertyToDelete = property;
    this.isDeleteConfirmOpen = true;
  }

  closeDeleteConfirm(): void {
    this.isDeleteConfirmOpen = false;
    this.propertyToDelete = null;
  }

  confirmDelete(): void {
    if (this.authService.isAdmin()) {
      this.closeDeleteConfirm();
      return;
    }
    if (this.propertyToDelete) {
      const id = this.propertyToDelete.id;
      this.tasinmazService.delete(id).subscribe({
        next: () => {
          this.properties = this.properties.filter(p => p.id !== id);
          if (this.selectedProperty && this.selectedProperty.id === id) {
            this.selectedProperty = null;
          }
          this.updateMainMapFeatures();
          this.openInfoAlert('Başarılı', 'Taşınmaz başarıyla silindi.');
        },
        error: (err) => {
          console.error(err);
          this.openInfoAlert('Hata', 'Silme işlemi sırasında hata oluştu.');
        }
      });
    }
    this.closeDeleteConfirm();
  }

  // Add/Edit Modal Control
  openAddModal(): void {
    if (this.authService.isAdmin()) {
      this.openInfoAlert('Yetkisiz İşlem', 'Yöneticiler (Admin) yeni taşınmaz ekleyemez.');
      return;
    }
    this.clearOptionalPhoto();
    this.isEditMode = false;
    this.editingId = null;
    
    this.filteredIlceler = [];
    this.filteredMahalleler = [];

    this.propertyForm.reset({
      isim: '',
      province: '',
      district: '',
      neighborhood: '',
      nitelik: 'Daire',
      ada: '',
      parsel: '',
      lat: 39.9208,
      lng: 32.8541,
      address: ''
    });

    this.propertyForm.get('district')?.disable();
    this.propertyForm.get('neighborhood')?.disable();
    
    this.isModalOpen = true;
    this.initMiniMap(39.9208, 32.8541);
  }

  openEditModal(property: Property): void {
    if (this.authService.isAdmin()) {
      this.openInfoAlert('Yetkisiz İşlem', 'Yöneticiler (Admin) taşınmaz düzenleyemez.');
      return;
    }
    this.isEditMode = true;
    this.editingId = property.id;
    
    // First, populate the filtered dropdown lists
    const il = this.illerList.find(i => i.ilAdi.toLowerCase() === property.province.toLowerCase());
    if (il) {
      this.filteredIlceler = this.ilcelerList.filter(i => i.ilId === il.id);
      const ilce = this.ilcelerList.find(i => i.ilId === il.id && i.ilceAdi.toLowerCase() === property.district.toLowerCase());
      if (ilce) {
        this.filteredMahalleler = this.mahallelerList.filter(m => m.ilceId === ilce.id);
      }
    }
    
    // Enable controls so they can show the values
    this.propertyForm.get('district')?.enable();
    this.propertyForm.get('neighborhood')?.enable();

    this.propertyForm.setValue({
      isim: property.isim,
      province: property.province,
      district: property.district,
      neighborhood: property.neighborhood,
      nitelik: property.nitelik,
      ada: property.ada,
      parsel: property.parsel,
      lat: property.lat,
      lng: property.lng,
      address: property.address || ''
    });
    
    this.isModalOpen = true;
    this.initMiniMap(property.lat, property.lng);
  }

  closeModal(): void {
    this.clearOptionalPhoto();
    this.isModalOpen = false;
    this.isEditMode = false;
    this.editingId = null;
    this.filteredIlceler = [];
    this.filteredMahalleler = [];
    if (this.miniMap) {
      this.miniMap.setTarget(undefined);
      this.miniMap = null;
    }
  }

  // Form submit (Add or Update)
  async onSubmit(): Promise<void> {
    if (this.authService.isAdmin()) {
      this.openInfoAlert('Yetkisiz İşlem', 'Yöneticiler (Admin) taşınmaz ekleyemez veya güncelleyemez.');
      return;
    }
    if (this.propertyForm.invalid) {
      this.propertyForm.markAllAsTouched();
      
      // Hatalı/boş alanı belirle ve oraya pürüzsüz kaydır (Kullanıcı arayüzünde gizlenmiş üst alanları görünür kılmak için)
      const firstInvalidControl = document.querySelector('.modal-form-body .form-group .error-msg, .modal-form-body .error-msg');
      if (firstInvalidControl) {
        firstInvalidControl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        const bodyEl = document.querySelector('.modal-form-body');
        if (bodyEl) {
          bodyEl.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }

      this.openInfoAlert(
        'Eksik Bilgi', 
        'Lütfen formdaki tüm zorunlu alanları eksiksiz doldurun (Taşınmaz Adı en az 3 karakter olmalıdır, İl/İlçe/Mahalle seçilmelidir, Ada/Parsel sayı olmalıdır vb.).'
      );
      return;
    }

    const formVal = this.propertyForm.value;

    try {
      // 1. CBS ilişkili MahalleId bilgisini akıllı metottan çek / oluştur
      const mahalleId = await this.getOrCreateMahalleId(
        formVal.province,
        formVal.district,
        formVal.neighborhood
      );

      // 2. DTO yapısına dönüştür
      const dto: TasinmazDto = {
        isim: formVal.isim,
        ada: formVal.ada,
        parsel: Number(formVal.parsel),
        nitelik: formVal.nitelik,
        adres: formVal.address,
        koordinatBilgisi: `${Number(formVal.lat)}, ${Number(formVal.lng)}`,
        mahalleId: mahalleId
      };

      if (this.isEditMode && this.editingId !== null) {
        dto.id = this.editingId;
        const targetId = this.editingId;
        this.tasinmazService.update(targetId, dto).subscribe({
          next: () => {
            if (this.optionalPhotoFile) {
              this.tasinmazService.uploadImage(targetId, this.optionalPhotoFile).subscribe({
                next: () => {
                  this.loadProperties();
                  this.openInfoAlert('Başarılı', 'Taşınmaz ve fotoğrafı başarıyla güncellendi.');
                  this.closeModal();
                },
                error: (err) => {
                  console.error(err);
                  this.loadProperties();
                  this.openInfoAlert('Bilgi', 'Taşınmaz güncellendi ancak fotoğrafı yüklenirken bir hata oluştu.');
                  this.closeModal();
                }
              });
            } else {
              this.loadProperties();
              this.openInfoAlert('Başarılı', 'Taşınmaz başarıyla güncellendi.');
              this.closeModal();
            }
          },
          error: (err) => {
            console.error(err);
            this.openInfoAlert('Hata', 'Güncelleme sırasında bir hata oluştu.');
          }
        });
      } else {
        this.tasinmazService.add(dto).subscribe({
          next: (res) => {
            if (this.optionalPhotoFile) {
              this.tasinmazService.uploadImage(res.id!, this.optionalPhotoFile).subscribe({
                next: () => {
                  this.loadProperties();
                  this.openInfoAlert('Başarılı', 'Taşınmaz ve fotoğrafı başarıyla eklendi.');
                  this.closeModal();
                },
                error: (err) => {
                  console.error(err);
                  this.loadProperties();
                  this.openInfoAlert('Bilgi', 'Taşınmaz eklendi ancak fotoğrafı yüklenirken bir hata oluştu.');
                  this.closeModal();
                }
              });
            } else {
              this.loadProperties();
              this.openInfoAlert('Başarılı', 'Taşınmaz başarıyla eklendi.');
              this.closeModal();
            }
          },
          error: (err) => {
            console.error(err);
            this.openInfoAlert('Hata', 'Ekleme sırasında bir hata oluştu.');
          }
        });
      }
    } catch (err) {
      console.error('İşlem başarısız:', err);
      this.openInfoAlert('Hata', 'İl, ilçe veya mahalle kaydı oluşturulurken hata oluştu.');
    }
  }

  // Info Alert popup
  openInfoAlert(title: string, message: string): void {
    this.infoAlertTitle = title;
    this.infoAlertMessage = message;
    this.isInfoAlertOpen = true;
  }

  closeInfoAlert(): void {
    this.isInfoAlertOpen = false;
  }

  // View Details Action
  viewDetails(property: Property): void {
    this.openInfoAlert(
      'Taşınmaz Detayları',
      `Taşınmaz Adı: ${property.isim}\nİl/İlçe: ${property.province} / ${property.district}\nMahalle: ${property.neighborhood}\nAda/Parsel: ${property.ada} / ${property.parsel}\nNitelik: ${property.nitelik}\nEnlem (Lat): ${property.lat}\nBoylam (Long): ${property.lng}\nAçık Adres: ${property.address}`
    );
  }

  // Otomatik Konum Bulma (Geocoding - OSM Nominatim)
  triggerAutoGeocoding(prov: string, dist: string, neigh: string): void {
    const addressQuery = `${neigh}, ${dist}, ${prov}, Türkiye`;
    if (addressQuery === this.lastGeocodedAddress) {
      return;
    }
    this.lastGeocodedAddress = addressQuery;

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addressQuery)}`;

    this.http.get<any[]>(url).subscribe({
      next: (results) => {
        if (results && results.length > 0) {
          const firstResult = results[0];
          const lat = Number(firstResult.lat);
          const lon = Number(firstResult.lon);

          // Form alanlarını güncelle (emitEvent: false ile sonsuz döngü engellenir)
          this.propertyForm.patchValue({
            lat: lat,
            lng: lon
          }, { emitEvent: false });

          // Mini haritadaki pini ve odaklanmayı güncelle
          this.updateMiniMapMarker(lat, lon);
          if (this.miniView) {
            this.miniView.animate({
              center: fromLonLat([lon, lat]),
              zoom: 15,
              duration: 800
            });
          }
        }
      },
      error: (err) => {
        console.error('Coğrafi konum bulunamadı:', err);
      }
    });
  }

  // Türkçe karakter dönüştürücü (standart PDF fontları Türkçe karakter desteklemediği için)
  replaceTurkishChars(str: string): string {
    if (!str) return '';
    return str
      .replace(/ı/g, 'i')
      .replace(/ş/g, 's')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c')
      .replace(/İ/g, 'I')
      .replace(/Ş/g, 'S')
      .replace(/Ğ/g, 'G')
      .replace(/Ü/g, 'U')
      .replace(/Ö/g, 'O')
      .replace(/Ç/g, 'C');
  }

  // Checkbox selection methods
  togglePropertySelection(id: number, event: any): void {
    if (event.target.checked) {
      if (!this.selectedPropertyIds.includes(id)) {
        this.selectedPropertyIds.push(id);
      }
    } else {
      this.selectedPropertyIds = this.selectedPropertyIds.filter(item => item !== id);
    }
  }

  isPropertySelected(id: number): boolean {
    return this.selectedPropertyIds.includes(id);
  }

  toggleAllProperties(event: any): void {
    if (event.target.checked) {
      this.selectedPropertyIds = this.filteredProperties.map(p => p.id);
    } else {
      this.selectedPropertyIds = [];
    }
  }

  isAllPropertiesSelected(): boolean {
    if (this.filteredProperties.length === 0) return false;
    return this.filteredProperties.every(p => this.selectedPropertyIds.includes(p.id));
  }

  // Excel Dışa Aktar (Backend-Side)
  exportToExcel(): void {
    const ids = this.selectedPropertyIds.length > 0 
      ? this.selectedPropertyIds 
      : this.filteredProperties.map(p => p.id);

    if (ids.length === 0) {
      this.openInfoAlert('Bilgi', 'Dışa aktarılacak taşınmaz kaydı bulunamadı.');
      return;
    }

    this.isExportingExcel = true;
    this.tasinmazService.exportExcel(ids).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Tasinmazlar_${new Date().getTime()}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        this.openInfoAlert('Başarılı', 'Excel dosyası başarıyla indirildi.');
        this.isExportingExcel = false;
      },
      error: (err) => {
        console.error(err);
        this.openInfoAlert('Hata', 'Excel dosyası indirilirken bir hata oluştu.');
        this.isExportingExcel = false;
      }
    });
  }

  // PDF Dışa Aktar (Backend-Side)
  exportToPdf(): void {
    const ids = this.selectedPropertyIds.length > 0 
      ? this.selectedPropertyIds 
      : this.filteredProperties.map(p => p.id);

    if (ids.length === 0) {
      this.openInfoAlert('Bilgi', 'Dışa aktarılacak taşınmaz kaydı bulunamadı.');
      return;
    }

    this.isExportingPdf = true;
    this.tasinmazService.exportPdf(ids).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Tasinmazlar_${new Date().getTime()}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        this.openInfoAlert('Başarılı', 'PDF dosyası başarıyla indirildi.');
        this.isExportingPdf = false;
      },
      error: (err) => {
        console.error(err);
        this.openInfoAlert('Hata', 'PDF dosyası indirilirken bir hata oluştu.');
        this.isExportingPdf = false;
      }
    });
  }

  // Excel İçe Aktar (Import)
  onExcelFileSelected(event: any): void {
    if (this.authService.isAdmin()) {
      this.openInfoAlert('Yetkisiz İşlem', 'Yöneticiler (Admin) taşınmaz içe aktaramaz.');
      event.target.value = '';
      return;
    }
    const file: File = event.target.files?.[0];
    if (!file) return;

    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (ext !== '.xlsx' && ext !== '.xls') {
      this.openInfoAlert('Hata', 'Sadece .xlsx ve .xls formatındaki Excel dosyalarını içe aktarabilirsiniz.');
      event.target.value = '';
      return;
    }

    this.isImportingExcel = true;
    this.tasinmazService.importExcel(file).subscribe({
      next: (res) => {
        this.isImportingExcel = false;
        event.target.value = '';
        const msg = res.message || `${res.successCount || 0} adet taşınmaz başarıyla içe aktarıldı.`;
        this.openInfoAlert('İçe Aktarma Başarılı', msg);
        // Listeyi ve haritayı yeniden yükle
        this.loadProperties();
      },
      error: (err) => {
        this.isImportingExcel = false;
        event.target.value = '';
        console.error('Excel içe aktarma hatası:', err);
        const errMsg = err.error?.message || err.error?.Message || 'Excel dosyası içe aktarılırken bir hata oluştu.';
        this.openInfoAlert('Hata', errMsg);
      }
    });
  }

  // Optional Photo Upload Methods
  onOptionalPhotoSelected(event: any): void {
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > 100 * 1024 * 1024) {
      this.openInfoAlert('Hata', 'Dosya boyutu 100 MB\'tan büyük olamaz.');
      return;
    }

    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (ext !== '.jpg' && ext !== '.jpeg' && ext !== '.png') {
      this.openInfoAlert('Hata', 'Sadece .jpg, .jpeg veya .png formatında resim seçebilirsiniz.');
      return;
    }

    this.optionalPhotoFile = file;

    const reader = new FileReader();
    reader.onload = () => {
      this.optionalPhotoPreview = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  clearOptionalPhoto(): void {
    this.optionalPhotoFile = null;
    this.optionalPhotoPreview = null;
  }

  // Bulk Delete Confirmation Modals
  openBulkDeleteConfirm(): void {
    if (this.authService.isAdmin()) {
      this.openInfoAlert('Yetkisiz İşlem', 'Yöneticiler (Admin) taşınmaz silemez.');
      return;
    }
    this.isBulkDeleteConfirmOpen = true;
  }

  closeBulkDeleteConfirm(): void {
    this.isBulkDeleteConfirmOpen = false;
  }

  confirmBulkDelete(): void {
    if (this.authService.isAdmin()) {
      this.closeBulkDeleteConfirm();
      return;
    }
    if (this.selectedPropertyIds.length === 0) return;

    this.tasinmazService.bulkDelete(this.selectedPropertyIds).subscribe({
      next: () => {
        this.openInfoAlert('Başarılı', 'Seçilen tüm taşınmazlar başarıyla silindi.');
        this.selectedPropertyIds = [];
        this.loadProperties();
        this.closeBulkDeleteConfirm();
      },
      error: (err) => {
        console.error(err);
        this.openInfoAlert('Hata', 'Toplu silme işlemi gerçekleştirilemedi.');
        this.closeBulkDeleteConfirm();
      }
    });
  }
}
