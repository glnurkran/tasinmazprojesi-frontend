import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { LogDto } from '../models/log.model';

@Injectable({
  providedIn: 'root'
})
export class LogService {
  private baseUrl = `${environment.apiUrl}/log`;

  constructor(private http: HttpClient) {}

  // Logları filtreleyerek getirir
  getAll(
    userId?: number,
    islem?: string,
    baslangicTarihi?: string,
    bitisTarihi?: string
  ): Observable<LogDto[]> {
    let params = new HttpParams();
    if (userId !== undefined && userId !== null) params = params.set('userId', userId.toString());
    if (islem) params = params.set('islem', islem);
    if (baslangicTarihi) params = params.set('baslangicTarihi', baslangicTarihi);
    if (bitisTarihi) params = params.set('bitisTarihi', bitisTarihi);

    return this.http.get<LogDto[]>(this.baseUrl, { params });
  }

  // Logları Excel olarak indirir (Blob biçiminde)
  exportExcel(
    userId?: number,
    islem?: string,
    baslangicTarihi?: string,
    bitisTarihi?: string
  ): Observable<Blob> {
    let params = new HttpParams();
    if (userId !== undefined && userId !== null) params = params.set('userId', userId.toString());
    if (islem) params = params.set('islem', islem);
    if (baslangicTarihi) params = params.set('baslangicTarihi', baslangicTarihi);
    if (bitisTarihi) params = params.set('bitisTarihi', bitisTarihi);

    return this.http.get(`${this.baseUrl}/export-excel`, { params, responseType: 'blob' });
  }

  // Logları PDF olarak indirir (Blob biçiminde)
  exportPdf(
    userId?: number,
    islem?: string,
    baslangicTarihi?: string,
    bitisTarihi?: string
  ): Observable<Blob> {
    let params = new HttpParams();
    if (userId !== undefined && userId !== null) params = params.set('userId', userId.toString());
    if (islem) params = params.set('islem', islem);
    if (baslangicTarihi) params = params.set('baslangicTarihi', baslangicTarihi);
    if (bitisTarihi) params = params.set('bitisTarihi', bitisTarihi);

    return this.http.get(`${this.baseUrl}/export-pdf`, { params, responseType: 'blob' });
  }
}
