import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { TasinmazDto } from '../models/tasinmaz.model';
import { TasinmazResim } from '../models/tasinmaz-resim.model';

@Injectable({
  providedIn: 'root'
})
export class TasinmazService {
  private baseUrl = `${environment.apiUrl}/tasinmaz`;

  constructor(private http: HttpClient) {}

  getAll(): Observable<TasinmazDto[]> {
    return this.http.get<TasinmazDto[]>(this.baseUrl);
  }

  getById(id: number): Observable<TasinmazDto> {
    return this.http.get<TasinmazDto>(`${this.baseUrl}/${id}`);
  }

  add(dto: TasinmazDto): Observable<TasinmazDto> {
    return this.http.post<TasinmazDto>(this.baseUrl, dto);
  }

  update(id: number, dto: TasinmazDto): Observable<TasinmazDto> {
    return this.http.put<TasinmazDto>(`${this.baseUrl}/${id}`, dto);
  }

  delete(id: number): Observable<string> {
    return this.http.delete(`${this.baseUrl}/${id}`, { responseType: 'text' });
  }

  exportExcel(selectedIds?: number[]): Observable<Blob> {
    let params: any = {};
    if (selectedIds && selectedIds.length > 0) {
      params.selectedIds = selectedIds.join(',');
    }
    return this.http.get(`${this.baseUrl}/export-excel`, { params, responseType: 'blob' });
  }

  exportPdf(selectedIds?: number[]): Observable<Blob> {
    let params: any = {};
    if (selectedIds && selectedIds.length > 0) {
      params.selectedIds = selectedIds.join(',');
    }
    return this.http.get(`${this.baseUrl}/export-pdf`, { params, responseType: 'blob' });
  }

  getImages(propertyId: number): Observable<TasinmazResim[]> {
    return this.http.get<TasinmazResim[]>(`${this.baseUrl}/${propertyId}/images`);
  }

  uploadImage(propertyId: number, file: File): Observable<TasinmazResim> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<TasinmazResim>(`${this.baseUrl}/${propertyId}/image`, formData);
  }

  deleteImage(imageId: number): Observable<any> {
    return this.http.delete(`${this.baseUrl}/image/${imageId}`);
  }

  bulkDelete(ids: number[]): Observable<any> {
    return this.http.post(`${this.baseUrl}/bulk-delete`, ids);
  }

  importExcel(file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<any>(`${this.baseUrl}/import-excel`, formData);
  }
}
