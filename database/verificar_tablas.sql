select count(*) as tablas_en_booking from information_schema.tables where table_schema = 'booking' and table_type = 'BASE TABLE';
