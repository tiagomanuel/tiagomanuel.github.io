# ------------------------------------------------------------
# Pacotes
# ------------------------------------------------------------
pkgs <- c("readxl","jsonlite","dplyr","lubridate")
inst <- pkgs[!pkgs %in% rownames(installed.packages())]
if (length(inst)) install.packages(inst, repos = "https://cloud.r-project.org")
lapply(pkgs, library, character.only = TRUE)

# ------------------------------------------------------------
# Config
# ------------------------------------------------------------
INPUT_XLSX  <- "itinerario.xlsx"
INPUT_SHEET <- "itinerario"
OUTPUT_JSON <- "docs/data.json"

# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------

# Excel serial → Date
from_excel_date <- function(x) as.Date(x, origin = "1899-12-30")

# Normalizar datas
normalize_date <- function(v) {
  if (is.numeric(v)) return(as.character(from_excel_date(v)))
  d <- suppressWarnings(dmy(v))
  ifelse(is.na(d), as.character(v), as.character(d))
}

# Normalizar horas → "HH:MM (HH:MM LX)"
normalize_time <- function(v, date) {
  sapply(seq_along(v), function(i) {
    x <- v[i]; d <- date[i]
    if (is.na(x) || trimws(x) == "") return("")
    
    # Hora local (Bangkok)
    if (is.numeric(x)) {
      secs <- round(x * 86400)          # Excel guarda fração de dia
      hms <- seconds_to_period(secs)
      hh <- sprintf("%02d", hour(hms))
      mm <- sprintf("%02d", minute(hms))
      local <- paste0(hh, ":", mm)
    } else {
      s <- as.character(x)
      if (grepl("^\\d{1,2}:\\d{2}", s)) {
        parts <- strsplit(s, ":")[[1]]
        hh <- sprintf("%02d", as.integer(parts[1]) %% 24)
        mm <- sprintf("%02d", as.integer(parts[2]) %% 60)
        local <- paste0(hh, ":", mm)
      } else {
        return(s) # se for algo irreconhecível, devolve como está
      }
    }
    
    # Calcular hora de Lisboa
    if (!is.na(d)) {
      dt_local <- ymd_hm(paste(d, local), tz = "Asia/Bangkok")
      dt_lx    <- with_tz(dt_local, "Europe/Lisbon")
      lx       <- format(dt_lx, "%H:%M")
      paste0(local, " (", lx, " LX)")
    } else {
      local
    }
  }, USE.NAMES = FALSE)
}

# Converter hora para minutos (para ordenar)
hhmm_to_minutes <- function(x) {
  if (is.na(x) || x == "") return(Inf)
  main <- sub(" .*", "", x)   # só HH:MM antes do espaço
  parts <- strsplit(main, ":")[[1]]
  if (length(parts) < 2) return(Inf)
  h <- suppressWarnings(as.integer(parts[1]))
  m <- suppressWarnings(as.integer(parts[2]))
  if (is.na(h) | is.na(m)) return(Inf)
  h * 60 + m
}

# ------------------------------------------------------------
# Ler Excel
# ------------------------------------------------------------
df <- read_excel(INPUT_XLSX, sheet = INPUT_SHEET)

# ------------------------------------------------------------
# Mapear colunas mínimas
# ------------------------------------------------------------
if ("Data" %in% names(df)) names(df)[names(df) == "Data"] <- "date"
if ("Hora" %in% names(df)) names(df)[names(df) == "Hora"] <- "time_start"

# ------------------------------------------------------------
# Normalizar
# ------------------------------------------------------------
df <- df %>%
  mutate(
    date       = normalize_date(date),
    time_start = normalize_time(time_start, date),
    time_end   = normalize_time(time_end,   date)
  )

# ------------------------------------------------------------
# Ordenar
# ------------------------------------------------------------
df <- df %>%
  mutate(.t_minutes = vapply(time_start, hhmm_to_minutes, numeric(1))) %>%
  arrange(date, .t_minutes) %>%
  select(-.t_minutes)

# ------------------------------------------------------------
# Exportar
# ------------------------------------------------------------
write_json(df, OUTPUT_JSON, pretty = TRUE, auto_unbox = TRUE, na = "null")
cat("✅ Gravado", OUTPUT_JSON, "com", nrow(df), "linhas\n")
