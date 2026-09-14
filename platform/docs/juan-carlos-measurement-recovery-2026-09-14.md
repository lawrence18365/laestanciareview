# Medición de reseñas — qué estaba mal, qué sí es confiable, y qué vamos a poder responder

**Para:** Juan Carlos, Dirección de Operaciones
**Fecha:** 14 de septiembre de 2026
**Alcance:** los 12 restaurantes del grupo

---

## A. Qué estaba mal

**La columna "Escaneos" estaba mal nombrada.** No contaba escaneos.

Contaba **calificaciones enviadas**: cada vez que un invitado tocó una estrella y
la calificación quedó guardada. No contaba cuántas veces se tocó la tarjeta NFC,
ni cuántas veces se abrió la pantalla.

Por eso, cuando en el panel de Querétaro aparecían **464 "Escaneos" y 464
"reseñas totales"**, no eran dos mediciones que coincidieran: **eran la misma
medición con dos nombres distintos.** Compararlas no decía nada, y la diferencia
que usted esperaba ver entre "escaneos" y "encuestas registradas" no podía
aparecer en esa pantalla, porque esa pantalla nunca tuvo un contador de escaneos.

Usted tenía razón al cuestionar el número. Ya está corregido: la etiqueta ahora
dice **"Calificaciones"** en todos los reportes semanales, y cada reporte incluye
la definición de cada métrica al pie. También corregimos "Opiniones capturadas",
que contaba lo mismo y sugería que eran comentarios escritos.

Esto no fue un problema de los restaurantes ni de los meseros. Fue un problema de
nuestra medición.

---

## B. Qué información histórica sigue siendo confiable

| Métrica | Estado | Desde cuándo | Por qué |
|---|---|---|---|
| **Calificaciones** (estrellas enviadas) | ✅ **Confiable históricamente** | Todo el historial | Cada calificación es un registro guardado; nunca cambió de definición |
| **Promedio de estrellas** | ✅ **Confiable históricamente** | Todo el historial | Se calcula de las mismas calificaciones |
| **Google** (clics al botón de Google) | ⚠️ **Parcialmente confiable** | Solo desde el **8 de julio de 2026** | Antes de esa fecha el dato significaba otra cosa; no es comparable hacia atrás |
| **Aperturas** (veces que se abrió la pantalla) | ⚠️ **Parcialmente confiable** | Solo desde el **21 de agosto de 2026** | Antes no se registraba. Además cuenta cada carga, sin distinguir recargas |
| **Pantalla mostrada** | ❌ **No reconstruible** | Solo desde el 14 de sept., 19:26 | El registro no existía antes. No se puede calcular hacia atrás |
| **Bloqueados** (pantalla no mostrada) | ❌ **No reconstruible** | Solo desde el 14 de sept., 19:26 | Igual: no existía el registro |
| **Sesiones únicas** | ❌ **No reconstruible** | Solo desde el 14 de sept., 19:26 | Igual: no existía el registro |
| **Tasa de recarga / bloqueo** | ❌ **No reconstruible** | Solo desde el 14 de sept., 19:26 | Se derivan de los tres anteriores |

**Lo que no vamos a hacer:** estimar, inferir o "rellenar" las etapas que no se
registraban. Si alguien presenta un número de pantallas mostradas o bloqueadas de
antes del 14 de septiembre, ese número está inventado. No es recuperable con
ninguna consulta.

---

## C. Medición exacta a partir de hora cero

**Hora cero: 14 de septiembre de 2026, 19:26 UTC.** Desde ese momento medimos el
embudo completo. Nunca mezclamos porcentajes de antes y después de esa hora,
porque miden cosas distintas.

### El embudo canónico

```
  Aperturas            se abrió la pantalla de calificación
        ↓
  Pantalla mostrada    la pantalla sí se mostró al invitado
        ↓
  Calificaciones       el invitado envió su calificación
        ↓
  Google               el invitado tocó el botón de reseña de Google
```

### Medidas que se reportan aparte, no como etapas del embudo

| Medida | Qué es |
|---|---|
| **Bloqueados** | Aperturas donde **no** se mostró la pantalla porque el mismo teléfono ya había calificado hace poco |
| **Sesiones únicas** | Pestañas distintas del navegador. **No es lo mismo que invitados distintos** |
| **Tasa de recarga** | Proporción de cargas que no fueron una pestaña nueva (recargas, regresar atrás) |
| **Diferencia de reconciliación** | Aperturas menos (Pantalla + Bloqueados). Cargas registradas en el servidor sin respuesta del navegador (JavaScript bloqueado, el invitado salió antes). **No es una etapa del embudo** |

---

## D. Tabla por unidad — línea base de validación

> **Esto es una validación de la medición, NO un hallazgo operativo.**
> La instrumentación llevaba **15 minutos** activa cuando se tomó esta foto. Los
> números son diminutos a propósito. Sirven para comprobar que el sistema mide
> bien y cuadra consigo mismo, no para decir nada sobre ningún restaurante.
> Cualquier conclusión operativa sacada de esta tabla sería falsa.

Ventana: 14 sept 19:26 UTC → 14 sept 19:41 UTC

| Unidad | Apert | Sesiones | Pantalla | Bloq | Calif | Google | Ap→Pant | Pant→Calif | Calif→Google | Recarga | Bloqueo | Muestra |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Estancia Querétaro | 1 | 1 | 1 | 0 | 0 | 0 | n=1* | n=1* | — | n=1* | n=1* | muy bajo |
| Estancia Angelópolis | 0 | 0 | 0 | 0 | 0 | 0 | — | — | — | — | — | sin datos |
| Estancia Juárez | 0 | 0 | 0 | 0 | 0 | 0 | — | — | — | — | — | sin datos |
| Estancia León | 0 | 0 | 0 | 0 | 0 | 0 | — | — | — | — | — | sin datos |
| Estancia Veracruz | 0 | 0 | 0 | 0 | 0 | 0 | — | — | — | — | — | sin datos |
| Estancia Xalapa | 0 | 0 | 0 | 0 | 0 | 0 | — | — | — | — | — | sin datos |
| Harbor's Angelópolis | 0 | 0 | 0 | 0 | 0 | 0 | — | — | — | — | — | sin datos |
| Harbor's Veracruz | 0 | 0 | 0 | 0 | 0 | 0 | — | — | — | — | — | sin datos |
| La Silla Huexotitla | 0 | 0 | 0 | 0 | 0 | 0 | — | — | — | — | — | sin datos |
| La Silla Juárez | 0 | 0 | 0 | 0 | 0 | 0 | — | — | — | — | — | sin datos |
| Regio Norte | 0 | 0 | 0 | 0 | 0 | 0 | — | — | — | — | — | sin datos |
| SteakCompany Querétaro | 0 | 0 | 0 | 0 | 0 | 0 | — | — | — | — | — | sin datos |
| **GRUPO** | **1** | **1** | **1** | **0** | **0** | **0** | n=1* | n=1* | — | n=1* | n=1* | muy bajo |

`n=1*` significa: el denominador es 1. No es un porcentaje, es un conteo.
Ninguna unidad se omite por tener ceros: un cero es un dato, y cuando una unidad
desaparece de un reporte es imposible notar que dejó de registrar.

**Lo que esta línea base sí demuestra:** la diferencia de reconciliación es **0**
(1 apertura = 1 pantalla + 0 bloqueados). Las cargas del servidor cuadran
exactamente con lo que reportó el navegador. El sistema mide de forma consistente.

---

## E. Su hipótesis sobre la calificación

Usted planteó que la caída podría estar relacionada con la calificación que da el
invitado. Así lo vamos a probar, y así lo vamos a reportar:

| Calificación | Calificaciones | Google | Tasa Google | Muestra |
|---|---|---|---|---|
| 1★ | 121 | 21 | **17.4%** | medio |
| 2★ | 7 | 0 | n=7* | muy bajo |
| 3★ | 17 | 6 | n=17* | muy bajo |
| 4★ | 173 | 81 | **46.8%** | medio |
| 5★ | 5,621 | 3,704 | **65.9%** | alto |

*(30 días al 14 sept. Calificaciones y clics de Google son confiables en esta
ventana; no incluye ninguna etapa no reconstruible.)*

**Lo que esto sí dice:** entre más alta la calificación, más probable es que el
invitado pase a Google. Un 5★ va a Google casi 4 veces más que un 1★. Esto es el
diseño funcionando: al invitado molesto se le ofrece el canal privado y lo toma.

**Lo que esto NO puede decir, y es importante:** esto sólo mide lo que pasó
**después** de que el invitado envió su calificación. Si un invitado abandonó
**antes** de calificar, no existe ninguna calificación asociada a él — no hay 1★
ni 5★ que atribuirle. **Por construcción, la calificación no puede explicar el
abandono que ocurre antes de que exista una calificación.** Cualquier explicación
de ese abandono tiene que venir de Aperturas → Pantalla mostrada, que es
exactamente la etapa que acabamos de empezar a medir.

2★ y 3★ tienen muestras demasiado pequeñas (7 y 17) para leerlas como tasas.

---

## F. Qué vamos a poder responder, y cuándo

### Ahora

- Cuántas calificaciones lleva cada unidad, en cualquier periodo. **Confiable.**
- Cuántos clics a Google, desde el 8 de julio. **Confiable.**
- Promedio de estrellas por unidad. **Confiable.**
- La tasa de Google por calificación (la tabla de la sección E). **Confiable.**
- Que la medición cuadra consigo misma (diferencia de reconciliación = 0).

### Después de 48 horas

- **Qué proporción de aperturas llega a ver la pantalla**, por unidad.
- **Cuántas aperturas bloquea el límite de visita repetida**, por unidad.
- **Qué proporción de las cargas son recargas** y no invitados distintos — esto
  responde directamente a la pregunta de los toques duplicados.
- Si las unidades con más bloqueos son las mismas que bajaron en septiembre.
  **Esto sería una coincidencia observada, no una causa demostrada.**

### Después de 7 días

- Diferencias por día de la semana y por turno, separadas de las diferencias
  entre unidades.
- Suficientes datos por unidad para que los porcentajes dejen de estar
  suprimidos por muestra insuficiente.
- Una semana completa lunes–domingo que se puede cuadrar línea por línea contra
  el reporte semanal por correo.

### Lo que no vamos a afirmar

La causa de la caída de conversión del 4 de septiembre sigue **sin determinar**.
Ese día se cambiaron dos cosas a la vez y ninguna estaba medida. No vamos a
atribuirla a una ni a otra hasta tener datos suficientes. Preferimos decirle "no
sabemos todavía" que darle una causa que después haya que retirar.

---

## Anexo — Histórico de 30 días (sólo métricas confiables)

> **Denominadores distintos a los de la sección D. No se mezclan nunca.**
> Esta tabla cubre **30 días completos** (15 ago → 14 sept) y contiene **sólo**
> las métricas que existen durante toda esa ventana. No incluye Pantalla
> mostrada, Bloqueados, Sesiones, tasa de recarga ni tasa de bloqueo, porque esos
> registros no existían. Los porcentajes de esta tabla **no** son comparables con
> los de la sección D: miden etapas distintas sobre bases distintas.

| Unidad | Calificaciones | Google | Calif→Google | Promedio ★ | Aperturas (parcial) | Muestra |
|---|---|---|---|---|---|---|
| Estancia Angelópolis | 1,404 | 905 | 64.5% | 4.87 | 1,683 | alto |
| Estancia Querétaro | 967 | 504 | 52.1% | 4.90 | 1,316 | alto |
| SteakCompany Querétaro | 669 | 422 | 63.1% | 4.87 | 843 | alto |
| La Silla Juárez | 667 | 408 | 61.2% | 4.94 | 551 | alto |
| Estancia Veracruz | 555 | 379 | 68.3% | 4.81 | 648 | alto |
| Harbor's Angelópolis | 365 | 190 | 52.1% | 4.85 | 449 | medio |
| La Silla Huexotitla | 355 | 327 | 92.1% | 4.94 | 377 | medio |
| Harbor's Veracruz | 298 | 226 | 75.8% | 4.90 | 334 | medio |
| Estancia Xalapa | 295 | 210 | 71.2% | 4.79 | 465 | medio |
| Estancia León | 179 | 134 | 74.9% | 4.91 | 256 | medio |
| Estancia Juárez | 10 | 7 | n=10* | 5.00 | 21 | muy bajo |
| Regio Norte | 4 | 1 | n=4* | 5.00 | 12 | muy bajo |
| **GRUPO** | **5,768** | **3,713** | **64.4%** | — | **6,955** | alto |

**Notas que hay que leer junto con la tabla:**

- **Aperturas está marcada "(parcial)"** porque el registro empieza el 21 de
  agosto, no el 15. Su base es más corta que la de Calificaciones, así que **no
  se debe dividir una columna entre la otra.** Por eso no imprimimos ninguna
  conversión que use Aperturas en esta tabla.
- **Calif→Google es confiable** en esta ventana: ambos datos cubren los 30 días.
- Estancia Juárez y Regio Norte tienen volúmenes de 10 y 4 calificaciones. Sus
  porcentajes se muestran como conteo (`n=10*`, `n=4*`) y **no deben leerse como
  tasas ni compararse con las demás unidades.**
- La Silla Huexotitla aparece con 92.1% de paso a Google, muy por encima del
  grupo. Es un dato observado; **no afirmamos por qué**, y no lo usamos como
  ejemplo de nada hasta entenderlo.

---

## Cómo se genera este reporte

Un solo comando, repetible por cualquiera:

```
cd platform
npm run funnel:report                                    # desde hora cero
npm run funnel:report -- --start ISO --end ISO            # ventana explícita
npm run funnel:report -- --unit estancia-queretaro        # una unidad
npm run funnel:report -- --historical                     # sólo métricas confiables
```

Cada número de este documento sale de un evento o consulta específica:

| Número | Fuente exacta |
|---|---|
| Calificaciones | filas en la tabla `reviews` |
| Aperturas | evento `review_page_open` |
| Pantalla mostrada | evento `review_screen_shown` |
| Bloqueados | evento `review_blocked_local_guard` |
| Google | `reviews.sent_to_google = true` |
| Sesiones únicas | `session_id` de los eventos del navegador |

Si usted señala cualquier número y pregunta qué es exactamente, la respuesta está
en esta tabla.
