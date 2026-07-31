import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { TasinmazDto } from '../models/tasinmaz.model';

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
}
