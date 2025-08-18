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
# Função: normalizar hora → "HH:MM"
# ------------------------------------------------------------
normalize_time <- function(x) {
  sapply(x, function(v) {
    if (is.null(v) || is.na(v) || trimws(v) %in% c("", "-", "—")) return("")
    
    # Caso 1: numérico (fração de dia Excel)
    if (is.numeric(v)) {
      secs <- round(v * 86400)
      return(format(as.POSIXct(secs, origin="1970-01-01", tz="UTC"), "%H:%M"))
    }
    
    # Caso 2: já POSIXct
    if (inherits(v, "POSIXt")) {
      return(format(v, "%H:%M"))
    }
    
    # Caso 3: string tipo "HH:MM" ou "HH:MM:SS"
    s <- trimws(as.character(v))
    if (grepl("^\\d{1,2}:\\d{2}(:\\d{2})?$", s)) {
      t <- suppressWarnings(hms(s))
      if (!is.na(t)) return(format(t, "%H:%M"))
    }
    
    # fallback → devolve string original (mas limpa)
    s
  }, USE.NAMES = FALSE)
}

# ------------------------------------------------------------
# Ler Excel
# ------------------------------------------------------------
df <- read_excel(INPUT_XLSX, sheet = INPUT_SHEET)

# ------------------------------------------------------------
# Colunas esperadas
# ------------------------------------------------------------
expected <- c(
  "date","time_start","time_end","title","type","area",
  "lat","lon","lat_from","lon_from","lat_to","lon_to",
  "notes","flight_code","flight_from","flight_to","terminal",
  "address","url","phone"
)

missing <- setdiff(expected, names(df))
if (length(missing)) {
  stop("Faltam colunas no Excel: ", paste(missing, collapse=", "))
}

# ------------------------------------------------------------
# Normalizar apenas as horas
# ------------------------------------------------------------
df <- df %>%
  mutate(
    time_start = normalize_time(time_start),
    time_end   = normalize_time(time_end)
  ) %>%
  select(all_of(expected))

# ------------------------------------------------------------
# Exportar
# ------------------------------------------------------------
write_json(df, OUTPUT_JSON, pretty = TRUE, auto_unbox = TRUE, na = "null")

cat("✅ Gravado", OUTPUT_JSON, "com", nrow(df), "linhas\n")
