import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { IlDto, IlceDto, MahalleDto } from '../models/il-ilce-mahalle.model';

@Injectable({
  providedIn: 'root'
})
export class IlIlceMahalleService {
  private apiBase = environment.apiUrl;

  constructor(private http: HttpClient) {}

  // İl Endpoints
  getIller(): Observable<IlDto[]> {
    return this.http.get<IlDto[]>(`${this.apiBase}/il`);
  }

  getIlById(id: number): Observable<IlDto> {
    return this.http.get<IlDto>(`${this.apiBase}/il/${id}`);
  }

  addIl(dto: IlDto): Observable<IlDto> {
    return this.http.post<IlDto>(`${this.apiBase}/il`, dto);
  }

  // İlçe Endpoints
  getIlceler(): Observable<IlceDto[]> {
    return this.http.get<IlceDto[]>(`${this.apiBase}/ilce`);
  }

  getIlceById(id: number): Observable<IlceDto> {
    return this.http.get<IlceDto>(`${this.apiBase}/ilce/${id}`);
  }

  addIlce(dto: IlceDto): Observable<IlceDto> {
    return this.http.post<IlceDto>(`${this.apiBase}/ilce`, dto);
  }

  // Mahalle Endpoints
  getMahalleler(): Observable<MahalleDto[]> {
    return this.http.get<MahalleDto[]>(`${this.apiBase}/mahalle`);
  }

  getMahalleById(id: number): Observable<MahalleDto> {
    return this.http.get<MahalleDto>(`${this.apiBase}/mahalle/${id}`);
  }

  addMahalle(dto: MahalleDto): Observable<MahalleDto> {
    return this.http.post<MahalleDto>(`${this.apiBase}/mahalle`, dto);
  }
}
