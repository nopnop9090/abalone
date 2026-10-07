//! Minimaler JSON-Parser/-Serializer (nur std).
use std::fmt::Write;

#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Value>),
    Obj(Vec<(String, Value)>),
}

impl Value {
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Obj(o) => o.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        if let Value::Str(s) = self { Some(s) } else { None }
    }
    pub fn as_f64(&self) -> Option<f64> {
        if let Value::Num(n) = self { Some(*n) } else { None }
    }
    pub fn as_arr(&self) -> Option<&[Value]> {
        if let Value::Arr(a) = self { Some(a) } else { None }
    }
    pub fn obj(items: Vec<(&str, Value)>) -> Value {
        Value::Obj(items.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
    }
    pub fn num(n: impl Into<f64>) -> Value { Value::Num(n.into()) }
    pub fn str(s: impl Into<String>) -> Value { Value::Str(s.into()) }
}

pub fn parse(text: &str) -> Result<Value, String> {
    let mut p = Parser { s: text.as_bytes(), i: 0, depth: 0 };
    let v = p.value()?;
    p.ws();
    if p.i != p.s.len() { return Err("Zeichen nach JSON-Wert".into()); }
    Ok(v)
}

struct Parser<'a> { s: &'a [u8], i: usize, depth: u32 }

impl<'a> Parser<'a> {
    fn ws(&mut self) { while self.i < self.s.len() && matches!(self.s[self.i], b' ' | b'\t' | b'\n' | b'\r') { self.i += 1; } }
    fn peek(&self) -> Option<u8> { self.s.get(self.i).copied() }
    fn expect(&mut self, lit: &str, v: Value) -> Result<Value, String> {
        if self.s[self.i..].starts_with(lit.as_bytes()) { self.i += lit.len(); Ok(v) } else { Err(format!("ungültiges JSON bei {}", self.i)) }
    }
    fn value(&mut self) -> Result<Value, String> {
        self.ws();
        self.depth += 1;
        if self.depth > 32 { return Err("zu tief verschachtelt".into()); }
        let r = match self.peek().ok_or("unerwartetes Ende")? {
            b'n' => self.expect("null", Value::Null),
            b't' => self.expect("true", Value::Bool(true)),
            b'f' => self.expect("false", Value::Bool(false)),
            b'"' => self.string().map(Value::Str),
            b'[' => {
                self.i += 1;
                let mut a = Vec::new();
                self.ws();
                if self.peek() == Some(b']') { self.i += 1; } else {
                    loop {
                        a.push(self.value()?);
                        self.ws();
                        match self.peek() { Some(b',') => self.i += 1, Some(b']') => { self.i += 1; break; } _ => return Err("',' oder ']' erwartet".into()) }
                    }
                }
                Ok(Value::Arr(a))
            }
            b'{' => {
                self.i += 1;
                let mut o = Vec::new();
                self.ws();
                if self.peek() == Some(b'}') { self.i += 1; } else {
                    loop {
                        self.ws();
                        let k = self.string()?;
                        self.ws();
                        if self.peek() != Some(b':') { return Err("':' erwartet".into()); }
                        self.i += 1;
                        o.push((k, self.value()?));
                        self.ws();
                        match self.peek() { Some(b',') => self.i += 1, Some(b'}') => { self.i += 1; break; } _ => return Err("',' oder '}' erwartet".into()) }
                    }
                }
                Ok(Value::Obj(o))
            }
            _ => self.number(),
        };
        self.depth -= 1;
        r
    }
    fn number(&mut self) -> Result<Value, String> {
        let st = self.i;
        while self.i < self.s.len() && matches!(self.s[self.i], b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E') { self.i += 1; }
        std::str::from_utf8(&self.s[st..self.i]).ok().and_then(|t| t.parse::<f64>().ok()).map(Value::Num).ok_or_else(|| format!("ungültige Zahl bei {}", st))
    }
    fn hex4(&mut self) -> Result<u32, String> {
        let h = self.s.get(self.i..self.i + 4).and_then(|b| std::str::from_utf8(b).ok()).and_then(|t| u32::from_str_radix(t, 16).ok()).ok_or("ungültiges \\u")?;
        self.i += 4;
        Ok(h)
    }
    fn string(&mut self) -> Result<String, String> {
        if self.peek() != Some(b'"') { return Err("String erwartet".into()); }
        self.i += 1;
        let mut out: Vec<u8> = Vec::new();
        loop {
            let c = *self.s.get(self.i).ok_or("String nicht beendet")?;
            self.i += 1;
            match c {
                b'"' => break,
                b'\\' => {
                    let e = *self.s.get(self.i).ok_or("String nicht beendet")?;
                    self.i += 1;
                    let ch = match e {
                        b'n' => '\n', b't' => '\t', b'r' => '\r', b'b' => '\u{8}', b'f' => '\u{c}',
                        b'"' => '"', b'\\' => '\\', b'/' => '/',
                        b'u' => {
                            let mut cp = self.hex4()?;
                            if (0xD800..0xDC00).contains(&cp) && self.s[self.i..].starts_with(b"\\u") {
                                self.i += 2;
                                let lo = self.hex4()?;
                                cp = 0x10000 + ((cp - 0xD800) << 10) + (lo.wrapping_sub(0xDC00) & 0x3FF);
                            }
                            char::from_u32(cp).unwrap_or('\u{fffd}')
                        }
                        _ => return Err("ungültige Escape-Sequenz".into()),
                    };
                    let mut b = [0u8; 4];
                    out.extend_from_slice(ch.encode_utf8(&mut b).as_bytes());
                }
                _ => out.push(c),
            }
        }
        String::from_utf8(out).map_err(|_| "ungültiges UTF-8".to_string())
    }
}

pub fn to_string(v: &Value) -> String {
    let mut s = String::new();
    write_value(v, &mut s);
    s
}

fn write_value(v: &Value, o: &mut String) {
    match v {
        Value::Null => o.push_str("null"),
        Value::Bool(b) => o.push_str(if *b { "true" } else { "false" }),
        Value::Num(n) => {
            if n.fract() == 0.0 && n.abs() < 1e15 { let _ = write!(o, "{}", *n as i64); } else { let _ = write!(o, "{}", n); }
        }
        Value::Str(s) => write_str(s, o),
        Value::Arr(a) => {
            o.push('[');
            for (i, x) in a.iter().enumerate() { if i > 0 { o.push(','); } write_value(x, o); }
            o.push(']');
        }
        Value::Obj(m) => {
            o.push('{');
            for (i, (k, x)) in m.iter().enumerate() { if i > 0 { o.push(','); } write_str(k, o); o.push(':'); write_value(x, o); }
            o.push('}');
        }
    }
}

fn write_str(s: &str, o: &mut String) {
    o.push('"');
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            '\r' => o.push_str("\\r"),
            '\t' => o.push_str("\\t"),
            c if (c as u32) < 0x20 => { let _ = write!(o, "\\u{:04x}", c as u32); }
            c => o.push(c),
        }
    }
    o.push('"');
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip() {
        let t = r#"{"a":[1,2.5,-3],"b":"x\"y\nää","c":null,"d":true,"e":{}}"#;
        let v = parse(t).unwrap();
        assert_eq!(parse(&to_string(&v)).unwrap(), v);
        assert_eq!(v.get("a").unwrap().as_arr().unwrap().len(), 3);
        assert_eq!(v.get("b").unwrap().as_str().unwrap(), "x\"y\nää");
    }
    #[test]
    fn errors() {
        assert!(parse("{").is_err());
        assert!(parse("[1,]").is_err());
        assert!(parse("1 2").is_err());
        assert!(parse(&"[".repeat(100)).is_err());
    }
}
