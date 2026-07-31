export interface IlDto {
  id?: number;
  ilAdi: string;
}

export interface IlceDto {
  id?: number;
  ilceAdi: string;
  ilId: number;
}

export interface MahalleDto {
  id?: number;
  mahalleAdi: string;
  ilceId: number;
}
