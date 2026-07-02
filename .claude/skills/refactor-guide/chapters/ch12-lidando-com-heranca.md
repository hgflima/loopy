# Capítulo 12: Lidando com herança

## Core Idea
Herança é poderosa e fácil de usar errado. Mover membros para cima/baixo na hierarquia, extrair/condensar níveis e — quando a herança vira fardo — substituí-la por delegação (composição).

## Refatorações deste capítulo
- **Subir método (Pull Up Method)**: método idêntico em subclasses sobe para a superclasse.
- **Subir campo (Pull Up Field)**: campo duplicado nas subclasses sobe.
- **Subir corpo do construtor (Pull Up Constructor Body)**: lógica comum de construção sobe.
- **Descer método (Push Down Method)**: método relevante só para uma subclasse desce (cura de Refused Bequest).
- **Descer campo (Push Down Field)**: idem para campo usado por uma só subclasse.
- **Substituir código de tipos por subclasses (Replace Type Code with Subclasses)**: um campo "tipo" que dirige comportamento vira hierarquia — habilita `Replace Conditional with Polymorphism`.
- **Remover subclasse (Remove Subclass)**: subclasse que faz pouco vira campo na superclasse.
- **Extrair superclasse (Extract Superclass)**: duas classes com comum → crie superclasse e suba o compartilhado.
- **Condensar hierarquia (Collapse Hierarchy)**: super e subclasse muito parecidas se fundem.
- **Substituir subclasse por delegação (Replace Subclass with Delegate)**: troque herança por um objeto delegado — herança só serve uma vez e é rígida.
- **Substituir superclasse por delegação (Replace Superclass with Delegate)**: ex-"Replace Inheritance with Delegation"; quando a subclasse usa só parte da superclasse ou viola sua interface.

## Mental Models
- **Herança ↔ Delegação**: comece com herança (é simples); se virar problema (Refused Bequest, acoplamento, precisa de mais de um eixo de variação), migre para delegação. "Prefira composição a herança" — mas não dogmaticamente.
- **Pull Up ↔ Push Down**: membro comum sobe, membro específico desce. A superclasse guarda só o compartilhado.
- **Replace Type Code with Subclasses** é o passo que *destrava* o polimorfismo do Ch10.

## Code Examples
```javascript
// Replace Subclass with Delegate: herança rígida -> delegação flexível
class Booking {
  constructor(show, date) { this._show = show; this._date = date; }
  // antes: class PremiumBooking extends Booking {...}
  // agora: this._premiumDelegate = new PremiumBookingDelegate(this, extras);
}
```
- **What it demonstrates**: o comportamento "premium" vira delegado intercambiável, sem prender a classe a uma hierarquia.

## Key Takeaways
1. **Pull Up** o que é comum; **Push Down** o que é específico.
2. **Extract Superclass / Collapse Hierarchy** ajustam o número de níveis.
3. **Replace Type Code with Subclasses** abre caminho para polimorfismo (Ch10).
4. **Replace Subclass/Superclass with Delegate** quando herança vira fardo.
5. Herança primeiro, delegação quando doer — composição > herança, com bom senso.

## Connects To
- **Ch3**: cura Herança recusada, Classe grande, Intermediário.
- **Ch10**: polimorfismo que a hierarquia sustenta.
- **Ch7**: delegação e encapsulamento.
