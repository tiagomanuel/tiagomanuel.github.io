# Pacotes (mantém apenas os necessários)
pkgs <- c("readxl","jsonlite","dplyr","lubridate")
inst <- pkgs[!pkgs %in% rownames(installed.packages())]
if (length(inst)) install.packages(inst, repos = "https://cloud.r-project.org")

library(readxl)
library(jsonlite)
library(dplyr)
library(lubridate)

# ------------------------------------------------------------
# Config
# ------------------------------------------------------------
INPUT_XLSX  <- "itinerario.xlsx"        # caminho do teu ficheiro
INPUT_SHEET <- "itinerario"             # nome da folha
OUTPUT_JSON <- "docs/data.json"         # destino (sugestão: pasta data/)
dir.create(dirname(OUTPUT_JSON), showWarnings = FALSE, recursive = TRUE)

# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------

# Detecta se um vetor é plausivelmente "número de série" de Excel para datas
is_excel_date_numeric <- function(x) {
  is.numeric(x) && all(!is.na(x)) && all(x > 20000 & x < 60000) # ~ anos 1955–2079
}

# Converte número de série Excel (data) para Date
from_excel_date <- function(x) as.Date(x, origin = "1899-12-30") # Excel date origin (Windows)

# Converte várias formas de data para "YYYY-MM-DD"
normalize_date <- function(v) {
  if (is.numeric(v)) {
    return(as.character(from_excel_date(v)))
  }
  # tenta dmy, ymd, mdy em sequência
  s <- as.character(v)
  d <- suppressWarnings(lubridate::dmy(s))
  bad <- is.na(d)
  if (any(bad)) d[bad] <- suppressWarnings(lubridate::ymd(s[bad]))
  bad <- is.na(d)
  if (any(bad)) d[bad] <- suppressWarnings(lubridate::mdy(s[bad]))
  # fallback: se ainda NA, deixa string original
  out <- ifelse(is.na(d), s, as.character(d))
  out
}

# Converte hora Excel (fração do dia) ou string diversa para "HH:MM"
normalize_time <- function(v) {
  sapply(v, function(x) {
    if (is.na(x) || trimws(x) == "") return("")
    
    # caso numérico vindo do Excel (fração do dia)
    if (is.numeric(x)) {
      total_min <- round(x * 24 * 60)
      h <- sprintf("%02d", floor(total_min / 60) %% 24)
      m <- sprintf("%02d", total_min %% 60)
      return(paste0(h, ":", m))
    }
    
    s <- trimws(as.character(x))
    if (s == "" || is.na(s)) return("")
    
    # já vem como HH:MM ou HH:MM:SS
    if (grepl("^\\d{1,2}:\\d{2}(:\\d{2})?$", s)) {
      parts <- strsplit(s, ":", fixed = TRUE)[[1]]
      hh <- sprintf("%02d", suppressWarnings(as.integer(parts[1])) %% 24)
      mm <- sprintf("%02d", suppressWarnings(as.integer(parts[2])) %% 60)
      return(paste0(hh, ":", mm))
    }
    
    # tenta decimal de horas (ex.: "9.5" → 09:30)
    num <- suppressWarnings(as.numeric(s))
    if (!is.na(num)) {
      total_min <- round(num * 60)
      h <- sprintf("%02d", floor(total_min / 60) %% 24)
      m <- sprintf("%02d", total_min %% 60)
      return(paste0(h, ":", m))
    }
    
    # fallback: devolve string original (para não rebentar o mutate)
    s
  }, USE.NAMES = FALSE)
}


# Coerção segura para numérico (NA se falhar)
num_or_na <- function(x) {
  suppressWarnings(as.numeric(gsub(",", ".", as.character(x), fixed = FALSE)))
}

# Validação simples de latitude/longitude
valid_lat <- function(x) !is.na(x) & x >= -90 & x <= 90
valid_lon <- function(x) !is.na(x) & x >= -180 & x <= 180

# ------------------------------------------------------------
# Ler Excel
# ------------------------------------------------------------
df_raw <- read_excel(INPUT_XLSX, sheet = INPUT_SHEET)

# ------------------------------------------------------------
# Mapear nomes PT -> EN do teu esquema alvo (ajusta aqui se necessário)
# Exemplo de mapeamento frequente:
# Data       -> date
# Hora_Inicio-> time_start
# Hora_Fim   -> time_end
# Titulo     -> title
# Tipo       -> type
# Area       -> area
# Lat        -> lat
# Lon        -> lon
# Lat_Origem -> lat_from
# Lon_Origem -> lon_from
# Lat_Dest   -> lat_to
# Lon_Dest   -> lon_to
# Notas      -> notes
# Voo        -> flight_code
# Origem     -> flight_from
# Destino    -> flight_to
# Terminal   -> terminal
# Morada     -> address
# URL        -> url
# Telefone   -> phone
# Se já tens as colunas em EN, este bloco não altera.
mapa_nomes <- c(
  "Data"        = "date",
  "Hora"        = "time_start",   # se só tens uma coluna "Hora"
  "Hora_Inicio" = "time_start",
  "Hora_Fim"    = "time_end",
  "Titulo"      = "title",
  "Tipo"        = "type",
  "Area"        = "area",
  "Lat"         = "lat",
  "Lon"         = "lon",
  "Lat_Origem"  = "lat_from",
  "Lon_Origem"  = "lon_from",
  "Lat_Dest"    = "lat_to",
  "Lon_Dest"    = "lon_to",
  "Notas"       = "notes",
  "Voo"         = "flight_code",
  "Origem"      = "flight_from",
  "Destino"     = "flight_to",
  "Terminal"    = "terminal",
  "Morada"      = "address",
  "URL"         = "url",
  "Telefone"    = "phone"
)

# Renomear colunas que existam no DF
intersec <- intersect(names(df_raw), names(mapa_nomes))
names(df_raw)[match(intersec, names(df_raw))] <- mapa_nomes[intersec]

# ------------------------------------------------------------
# Assegurar todas as colunas alvo (criando vazias se não existirem)
cols_target <- c(
  "date","time_start","time_end","title","type","area",
  "lat","lon","lat_from","lon_from","lat_to","lon_to",
  "notes","flight_code","flight_from","flight_to","terminal",
  "address","url","phone"
)

for (nm in cols_target) {
  if (!nm %in% names(df_raw)) df_raw[[nm]] <- NA
}

# ------------------------------------------------------------
# Normalizações de tipos e formatos
# ------------------------------------------------------------
df_norm <- df_raw %>%
  mutate(
    # datas
    date = normalize_date(date),
    
    # horas
    time_start = normalize_time(time_start),
    time_end   = normalize_time(time_end),
    
    # strings básicas
    title       = ifelse(is.na(title) | title == "", "Sem título", as.character(title)),
    type        = ifelse(is.na(type)  | type  == "", "Outros",     as.character(type)),
    area        = as.character(area),
    notes       = as.character(notes),
    flight_code = as.character(flight_code),
    flight_from = as.character(flight_from),
    flight_to   = as.character(flight_to),
    terminal    = as.character(terminal),
    address     = as.character(address),
    url         = as.character(url),
    phone       = as.character(phone),
    
    # coordenadas (numéricas)
    lat      = num_or_na(lat),
    lon      = num_or_na(lon),
    lat_from = num_or_na(lat_from),
    lon_from = num_or_na(lon_from),
    lat_to   = num_or_na(lat_to),
    lon_to   = num_or_na(lon_to)
  )

# Validação de coordenadas fora de intervalo → NA
df_norm <- df_norm %>%
  mutate(
    lat      = ifelse(valid_lat(lat), lat, NA_real_),
    lon      = ifelse(valid_lon(lon), lon, NA_real_),
    lat_from = ifelse(valid_lat(lat_from), lat_from, NA_real_),
    lon_from = ifelse(valid_lon(lon_from), lon_from, NA_real_),
    lat_to   = ifelse(valid_lat(lat_to), lat_to, NA_real_),
    lon_to   = ifelse(valid_lon(lon_to), lon_to, NA_real_)
  )

# Ordenação por data e hora de início (converte HH:MM em minutos)
hhmm_to_minutes <- function(x) {
  ifelse(is.na(x) | x == "", Inf,
         tryCatch({
           parts <- strsplit(x, ":", fixed = TRUE)[[1]]
           as.integer(parts[1]) * 60 + as.integer(parts[2])
         }, error = function(e) Inf))
}

df_norm <- df_norm %>%
  mutate(
    .t_minutes = vapply(time_start, hhmm_to_minutes, FUN.VALUE = numeric(1))
  ) %>%
  arrange(date, .t_minutes) %>%
  select(all_of(cols_target))

# ------------------------------------------------------------
# Exportar JSON (pretty + auto_unbox; NA -> null)
# ------------------------------------------------------------
write_json(
  df_norm,
  OUTPUT_JSON,
  auto_unbox = TRUE,
  pretty    = TRUE,
  na        = "null"
)

cat("✅ Gravado", OUTPUT_JSON, "com", nrow(df_norm), "linhas\n")
