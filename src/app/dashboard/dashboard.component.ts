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
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Style, Icon } from 'ol/style';

import { Router } from '@angular/router';

// Services & Models
import { TasinmazService } from '../services/tasinmaz.service';
import { IlIlceMahalleService } from '../services/il-ilce-mahalle.service';
import { AuthService } from '../services/auth.service';
import { TasinmazDto } from '../models/tasinmaz.model';
import { IlDto, IlceDto, MahalleDto } from '../models/il-ilce-mahalle.model';

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
}

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit, AfterViewInit, OnDestroy {
  // Properties List
  properties: Property[] = [];

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
  mainVectorSource!: VectorSource;
  mainVectorLayer!: VectorLayer<VectorSource>;

  // OpenLayers Mini Map State (Modal)
  miniMap: Map | null = null;
  miniView: View | null = null;
  miniVectorSource: VectorSource | null = null;
  miniVectorLayer: VectorLayer<VectorSource> | null = null;

  // Map & Popup State
  selectedProperty: Property | null = null;
  popupOverlayCoordinate: number[] | null = null;

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

  constructor(
    private fb: FormBuilder,
    private tasinmazService: TasinmazService,
    private geoService: IlIlceMahalleService,
    public authService: AuthService,
    private router: Router,
    private http: HttpClient
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
            mahalleId: p.mahalleId
          };
        });

        this.updateMainMapFeatures();

        // Varsayılan ilk taşınmaza odaklan
        if (this.properties.length > 0) {
          setTimeout(() => {
            this.selectProperty(this.properties[0]);
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

    this.mainMap = new Map({
      target: 'main-map',
      layers: [
        new TileLayer({
          source: new OSM()
        }),
        this.mainVectorLayer
      ],
      view: this.mainView,
      controls: []
    });

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

  // Main Map Pin Refresh
  updateMainMapFeatures(): void {
    if (!this.mainVectorSource) return;
    this.mainVectorSource.clear();

    this.properties.forEach(p => {
      const feature = new Feature({
        geometry: new Point(fromLonLat([p.lng, p.lat])),
        property: p
      });

      const isSelected = this.selectedProperty && this.selectedProperty.id === p.id;
      const fillHex = isSelected ? '%23ef4444' : '%231e88e5'; // Kırmızı : Mavi
      const scale = isSelected ? 1.2 : 0.9;
      
      const pinSvg = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36" fill="${fillHex}"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;

      feature.setStyle(new Style({
        image: new Icon({
          src: pinSvg,
          scale: scale,
          anchor: [0.5, 1]
        })
      }));

      this.mainVectorSource.addFeature(feature);
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

      this.miniMap = new Map({
        target: 'mini-map',
        layers: [
          new TileLayer({
            source: new OSM()
          }),
          this.miniVectorLayer
        ],
        view: this.miniView,
        controls: []
      });

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
        features[0].setGeometry(new Point(fromLonLat([lng, lat])));
      }
      this.miniView.setCenter(fromLonLat([lng, lat]));
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
      p.address.toLowerCase().includes(query)
    );
  }

  // Select Pin & Focus Map
  selectProperty(property: Property): void {
    this.selectedProperty = property;
    this.updateMainMapFeatures();
    
    if (this.mainView) {
      this.mainView.animate({
        center: fromLonLat([property.lng, property.lat]),
        zoom: 18,
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
    this.propertyToDelete = property;
    this.isDeleteConfirmOpen = true;
  }

  closeDeleteConfirm(): void {
    this.isDeleteConfirmOpen = false;
    this.propertyToDelete = null;
  }

  confirmDelete(): void {
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
        this.tasinmazService.update(this.editingId, dto).subscribe({
          next: () => {
            this.loadProperties();
            this.openInfoAlert('Başarılı', 'Taşınmaz başarıyla güncellendi.');
            this.closeModal();
          },
          error: (err) => {
            console.error(err);
            this.openInfoAlert('Hata', 'Güncelleme sırasında bir hata oluştu.');
          }
        });
      } else {
        this.tasinmazService.add(dto).subscribe({
          next: (res) => {
            this.loadProperties();
            this.openInfoAlert('Başarılı', 'Taşınmaz başarıyla eklendi.');
            this.closeModal();
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

  // Excel Dışa Aktar (Client-Side)
  exportToExcel(): void {
    if (!this.filteredProperties || this.filteredProperties.length === 0) {
      this.openInfoAlert('Bilgi', 'Dışa aktarılacak taşınmaz kaydı bulunamadı.');
      return;
    }

    this.isExportingExcel = true;

    try {
      const dataToExport = this.filteredProperties.map((p, index) => ({
        'Sıra No': index + 1,
        'Taşınmaz Adı': p.isim,
        'İl': p.province,
        'İlçe': p.district,
        'Mahalle': p.neighborhood,
        'Ada': p.ada,
        'Parsel': p.parsel,
        'Nitelik': p.nitelik,
        'Enlem (Lat)': p.lat,
        'Boylam (Lng)': p.lng,
        'Açık Adres': p.address
      }));

      const worksheet = XLSX.utils.json_to_sheet(dataToExport);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Taşınmazlar');

      // Sütun genişliklerini otomatik ayarla
      const colWidths = [
        { wch: 8 },   // Sıra No
        { wch: 25 },  // Taşınmaz Adı
        { wch: 15 },  // İl
        { wch: 15 },  // İlçe
        { wch: 20 },  // Mahalle
        { wch: 10 },  // Ada
        { wch: 10 },  // Parsel
        { wch: 12 },  // Nitelik
        { wch: 15 },  // Enlem
        { wch: 15 },  // Boylam
        { wch: 35 }   // Açık Adres
      ];
      worksheet['!cols'] = colWidths;

      XLSX.writeFile(workbook, `Tasinmazlar_${new Date().getTime()}.xlsx`);
      this.openInfoAlert('Başarılı', 'Excel dosyası başarıyla indirildi.');
    } catch (err) {
      console.error(err);
      this.openInfoAlert('Hata', 'Excel dosyası oluşturulurken hata oluştu.');
    } finally {
      this.isExportingExcel = false;
    }
  }

  // PDF Dışa Aktar (Client-Side)
  exportToPdf(): void {
    if (!this.filteredProperties || this.filteredProperties.length === 0) {
      this.openInfoAlert('Bilgi', 'Dışa aktarılacak taşınmaz kaydı bulunamadı.');
      return;
    }

    this.isExportingPdf = true;

    try {
      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
      });

      // Rapor Başlığı
      doc.setFontSize(18);
      doc.setTextColor(30, 41, 59); // slate-800
      doc.text('TASINMAZ KAYITLARI LISTESI', 14, 20);

      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139); // slate-500
      doc.text(`Olusturulma Tarihi: ${new Date().toLocaleString()}`, 14, 26);
      doc.text(`Toplam Kayit Sayisi: ${this.filteredProperties.length}`, 14, 31);

      // Tablo Satırları (Türkçe karakterleri dönüştürerek)
      const tableRows = this.filteredProperties.map((p, index) => [
        index + 1,
        this.replaceTurkishChars(p.isim),
        this.replaceTurkishChars(p.province),
        this.replaceTurkishChars(p.district),
        this.replaceTurkishChars(p.neighborhood),
        p.ada,
        p.parsel,
        this.replaceTurkishChars(p.nitelik),
        `${p.lat}, ${p.lng}`,
        this.replaceTurkishChars(p.address)
      ]);

      const headers = [
        ['Sira No', 'Tasinmaz Adi', 'Il', 'Ilce', 'Mahalle', 'Ada', 'Parsel', 'Nitelik', 'Koordinat', 'Acik Adres']
      ];

      autoTable(doc, {
        head: headers,
        body: tableRows,
        startY: 38,
        theme: 'striped',
        headStyles: {
          fillColor: [30, 41, 59], // Slate-800
          textColor: [255, 255, 255],
          fontSize: 10,
          fontStyle: 'bold',
          halign: 'center'
        },
        bodyStyles: {
          fontSize: 9,
          valign: 'middle'
        },
        columnStyles: {
          0: { cellWidth: 15, halign: 'center' }, // Sira No
          1: { cellWidth: 35 },                  // Tasinmaz Adi
          2: { cellWidth: 20 },                  // Il
          3: { cellWidth: 20 },                  // Ilce
          4: { cellWidth: 25 },                  // Mahalle
          5: { cellWidth: 12, halign: 'center' }, // Ada
          6: { cellWidth: 12, halign: 'center' }, // Parsel
          7: { cellWidth: 20 },                  // Nitelik
          8: { cellWidth: 35, halign: 'center' }, // Koordinat
          9: { cellWidth: 'auto' }               // Acik Adres
        },
        margin: { top: 38, left: 14, right: 14, bottom: 15 },
        didDrawPage: (data) => {
          const pageCount = (doc as any).internal.getNumberOfPages();
          doc.setFontSize(8);
          doc.setTextColor(148, 163, 184); // Slate-400
          const str = `Sayfa ${data.pageNumber} / ${pageCount}`;
          doc.text(str, data.settings.margin.left, doc.internal.pageSize.height - 10);
        }
      });

      doc.save(`Tasinmazlar_${new Date().getTime()}.pdf`);
      this.openInfoAlert('Başarılı', 'PDF dosyası başarıyla indirildi.');
    } catch (err) {
      console.error(err);
      this.openInfoAlert('Hata', 'PDF dosyası oluşturulurken hata oluştu.');
    } finally {
      this.isExportingPdf = false;
    }
  }
}
