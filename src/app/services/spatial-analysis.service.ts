import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface GeometryRequestDto {
  label: string;
  geometries?: string[]; // GeoJSON strings
  selectedLabel?: string;
  operationType: string; // "A_INTERSECT_B", "B_INTERSECT_A", "A_UNION_B", "A_UNION_B_UNION_C"
}

export interface GeometryResultDto {
  label: string;
  operationType: string;
  operationLabel: string;
  resultGeometryType: string;
  resultGeometryGeoJson: string;
  resultAreaM2: number;
  resultAreaHectare: number;
  hasResult: boolean;
  isPersisted: boolean;
  message: string;
  sourceGeometryIds?: string;
  createdAt: string;
}

export interface SpatialGeometry {
  id: number;
  userId: number;
  label: string;
  geometry: string; // GeoJSON string
  operationType: string; // "A", "B", "C", "D", "E"
  areaSquareMeters: number;
  sourceGeometryIds?: string;
  createdAt: string;
}

@Injectable({
  providedIn: 'root'
})
export class SpatialAnalysisService {
  private baseUrl = `${environment.apiUrl}/spatialanalysis`;

  constructor(private http: HttpClient) {}

  saveGroup(dto: GeometryRequestDto): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/save-group`, dto);
  }

  getGroups(): Observable<string[]> {
    return this.http.get<string[]>(`${this.baseUrl}/groups`);
  }

  getGroupGeometries(label: string): Observable<SpatialGeometry[]> {
    return this.http.get<SpatialGeometry[]>(`${this.baseUrl}/group/${encodeURIComponent(label)}`);
  }

  analyze(dto: GeometryRequestDto): Observable<GeometryResultDto> {
    return this.http.post<GeometryResultDto>(`${this.baseUrl}/analyze`, dto);
  }

  deleteGroup(label: string): Observable<any> {
    return this.http.delete<any>(`${this.baseUrl}/group/${encodeURIComponent(label)}`);
  }

  deleteGeometry(id: number): Observable<any> {
    return this.http.delete<any>(`${this.baseUrl}/geometry/${id}`);
  }

  saveSingle(dto: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/save-single`, dto);
  }
}
