CREATE TABLE currency_rates (
  from_currency VARCHAR(3) NOT NULL,
  to_currency VARCHAR(3) NOT NULL,
  rate DECIMAL(12,4) NOT NULL,
  source VARCHAR(50) DEFAULT 'exchangerate-api',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (from_currency, to_currency)
);

INSERT INTO currency_rates (from_currency, to_currency, rate)
VALUES ('USD', 'KZT', 530.0);
